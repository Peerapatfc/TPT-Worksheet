// Groq content for PAGE_RENDERER=hybrid: one structured layout spec per
// worksheet/activity page, drawn entirely by the layout engine (src/lib/layout/).
// There is no imageSpec: the only picture on a page is a decorative FLUX
// illustration, so no question, clue or task may depend on it. Answer keys are
// derived in code from each spec (layoutAnswerKey), so they always match the page.
//
// Flow per set: suggestLayout (code hint) → Groq in chunks of HYBRID_PAGES_PER_CALL
// pages → normalize + repair + strict validation (+ a dry render for overflow) →
// failed pages are re-asked with their errors (HYBRID_MAX_ATTEMPTS) → a page that
// still fails falls back to the `questions` layout built from any valid plain Q&A
// it produced, or else to the legacy content prompt (imageSpec + questions), which
// the router sends to the P1/P2 classifier or gpt-image-2. Then a structured Groq
// recheck verifies the answers. The legacy path (generate-content.js) is untouched.
import { groq } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'
import { addReviewNote } from '../lib/review-notes.js'
import { validateLayoutSpec, layoutAnswerKey, LIMITS, POLYGONS, FRACTION_SHAPES, LETTERS, mcAnswerIndex } from '../lib/layout/specs.js'
import { cleanText, LayoutOverflowError } from '../lib/layout/measure.js'
import { renderLayout } from '../lib/layout/index.js'
import { validateChart, repairChart, CHART_TYPES, CHART_ICONS, CHART_LIMITS } from '../lib/chart-page.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { isOpenEndedQuestion, isLayoutQuestion, chunk, recheckWithSplit, recheckConcurrency, RECHECK_PAGES_PER_CALL } from './generate-content.js'

export const HYBRID_LAYOUTS = ['questions', 'fill_blank', 'multiple_choice', 'matching', 'sorting', 'labeling', 'table_fill', 'shapes', 'activity_art', 'chart']
// Groq free tier: 8000 TPM for gpt-oss-120b, counted as prompt + max_tokens. The
// prompt is ~2.6k tokens + ~120 per page, so 3 pages + 3000 reserved ≈ 6k per call.
export const HYBRID_PAGES_PER_CALL = 3
export const HYBRID_MAX_TOKENS = 3000
export const HYBRID_MAX_ATTEMPTS = 3

// ── Tool schema ──────────────────────────────────────────────────────────────
// gpt-oss fills fields that do not apply to a page with null, "" or an empty object
// ("options": "", "chart": { "type": "" }), and Groq rejects the WHOLE call (400
// tool_use_failed) when such a value breaks the schema. So every optional field also
// accepts null or any string, and enums inside optional fields are only described
// (not enforced) — the validators in this file and specs.js enforce them, treat
// null/""/wrong types as absent, and send precise errors back on a retry.
const looseEnums = (s) => {
  if (Array.isArray(s)) return s.map(looseEnums)
  if (!s || typeof s !== 'object') return s
  const out = {}
  for (const [k, v] of Object.entries(s)) if (k !== 'enum') out[k] = (k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, looseEnums(pv)])) : looseEnums(v))
  if (s.enum) out.description = `${s.description ? `${s.description}; ` : ''}one of: ${s.enum.join(', ')}`
  return out
}
const orNull = (s) => {
  const typed = looseEnums(s)
  const { description, ...rest } = typed
  return { ...(description ? { description } : {}), anyOf: [rest, { type: 'null' }, { type: 'string' }] }
}
const strArr = (description) => orNull({ type: 'array', items: { type: 'string' }, description })
const SHAPE_NAMES = [...new Set([...Object.keys(POLYGONS), ...FRACTION_SHAPES])]

export const hybridContentTool = {
  type: 'function',
  function: {
    name: 'generate_layout_content',
    description: 'Generate the structured content of each worksheet page for its layout',
    parameters: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              title: { type: 'string' },
              layout: { type: 'string', enum: HYBRID_LAYOUTS },
              illustrationSubject: orNull({ type: 'string', description: 'decorative picture: concrete noun phrase, max 8 words, no text' }),
              questions: orNull({
                type: 'array',
                description: 'questions / multiple_choice / chart; optional extra questions on table_fill',
                items: {
                  type: 'object',
                  properties: {
                    num: { type: 'integer' },
                    question: { type: 'string' },
                    options: strArr('multiple_choice only: 2–4 choices'),
                    answer: { type: 'string' },
                  },
                  required: ['num', 'question', 'answer'],
                },
              }),
              wordBank: strArr('fill_blank'),
              sentences: orNull({
                type: 'array',
                description: 'fill_blank: sentence with ___ where the answer goes',
                items: { type: 'object', properties: { num: { type: 'integer' }, sentence: { type: 'string' }, answer: { type: 'string' } }, required: ['num', 'sentence', 'answer'] },
              }),
              pairs: orNull({
                type: 'array',
                description: 'matching',
                items: { type: 'object', properties: { term: { type: 'string' }, match: { type: 'string' } }, required: ['term', 'match'] },
              }),
              categories: strArr('sorting: column headings'),
              sortItems: orNull({
                type: 'array',
                description: 'sorting',
                items: { type: 'object', properties: { word: { type: 'string' }, category: { type: 'string' } }, required: ['word', 'category'] },
              }),
              subject: orNull({ type: 'string', description: 'labeling / activity_art: the one thing drawn' }),
              labels: orNull({
                type: 'array',
                description: 'labeling',
                items: { type: 'object', properties: { word: { type: 'string' }, clue: { type: 'string' } }, required: ['word', 'clue'] },
              }),
              columns: strArr('table_fill: column headers'),
              rows: orNull({ type: 'array', description: 'table_fill: one array of cell strings per row; a blank cell is its answer in [square brackets]', items: { type: 'array', items: { type: 'string' } } }),
              shapeItems: orNull({
                type: 'array',
                description: 'shapes',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['fraction', 'count', 'polygon'] },
                    shape: orNull({ type: 'string', enum: SHAPE_NAMES }),
                    parts: orNull({ type: 'integer' }),
                    shaded: orNull({ type: 'integer' }),
                    ask: orNull({ type: 'string', enum: ['name', 'shade', 'sides', 'corners'] }),
                    icon: orNull({ type: 'string', enum: CHART_ICONS }),
                    count: orNull({ type: 'integer' }),
                  },
                  required: ['kind'],
                },
              }),
              instruction: orNull({ type: 'string', description: 'activity_art only' }),
              tasks: strArr('activity_art only: up to 3 short extra lines'),
              chart: orNull({
                type: 'object',
                description: 'chart only',
                properties: {
                  type: { type: 'string', enum: CHART_TYPES },
                  title: { type: 'string' },
                  icon: orNull({ type: 'string', enum: CHART_ICONS }),
                  unit: orNull({ type: 'string' }),
                  labelHeader: orNull({ type: 'string' }),
                  valueHeader: orNull({ type: 'string' }),
                  categories: {
                    type: 'array',
                    items: { anyOf: [{ type: 'object', properties: { label: { type: 'string' }, value: { type: 'integer' } }, required: ['label', 'value'] }, { type: 'string' }] },
                  },
                },
                // No required keys: gpt-oss writes `chart: {}` on non-chart pages, and a
                // required key there fails the whole call (400 tool_use_failed).
                // validateChart checks chart pages.
              }),
            },
            required: ['pageNum', 'title', 'layout'],
          },
        },
      },
      required: ['pages'],
    },
  },
}

// ── Layout hint ──────────────────────────────────────────────────────────────
const HINTS = [
  ['chart', /\b(picture graph|pictograph|bar graph|tally (chart|marks)|graph)\b/i],
  ['shapes', /\b(fractions?|shade|shaded|polygons?|shapes?|sides|corners|vertices|count the)\b/i],
  ['matching', /\b(match(es|ing)?|connect|draw a line|pair)\b/i],
  ['sorting', /\b(sort(ing)?|classify|categor(y|ies|ize)|group the|columns? for)\b/i],
  ['labeling', /\b(label(l?ing|l?ed)?|diagram|parts of)\b/i],
  ['table_fill', /\b(table|chart to complete|fill in the chart)\b/i],
  ['activity_art', /\b(colou?r(ing)?|draw and|trace)\b/i],
  ['fill_blank', /\b(fill[- ]in|blanks?|word bank|complete the sentences?|missing word)\b/i],
  ['multiple_choice', /\b(multiple[- ]choice|quiz|true or false|true\/false|circle the correct)\b/i],
]

/** Layout suggested by the brainstorm page description (keyword hint; Groq may override). Pure. */
export function suggestLayout(page) {
  const text = `${page?.filename ?? ''} ${page?.imagePrompt ?? ''}`.replace(/[-_]+/g, ' ')
  return HINTS.find(([, re]) => re.test(text))?.[0] ?? 'questions'
}

// ── Prompt ───────────────────────────────────────────────────────────────────
export function questionRange(packageType) {
  return packageType === 'free' ? [4, 5] : packageType === 'large' ? [5, 8] : [4, 6]
}

/** Hybrid content prompt for a chunk of pages. `feedback` maps pageNum → errors from a failed attempt. Pure. */
export function buildHybridContentPrompt(plan, pages, feedback = new Map()) {
  const [qMin, qMax] = questionRange(plan.packageType)
  const pageList = pages.map(p => {
    const fb = feedback.get(p.pageNum)
    return `- Page ${p.pageNum} (${p.type}, suggested layout: ${suggestLayout(p)}): ${p.imagePrompt}${fb ? `\n  PREVIOUS ATTEMPT WAS REJECTED — fix: ${fb.join('; ')}` : ''}`
  }).join('\n')

  return `You are a curriculum designer writing printable worksheets for Teachers Pay Teachers.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Every page is typeset by code from the structured data you return. Pick ONE layout per page and fill ONLY that layout's fields (leave the others out):
- questions: questions [{num, question, answer}], ${qMin}–${qMax} items. Short-answer knowledge questions or word problems.
- multiple_choice: questions [{num, question, options (2–4), answer}], ${qMin}–${qMax} items. answer = the letter (A–D) of the one correct option; options distinct.
- fill_blank: wordBank (the answers, ≤3 words each) + sentences [{num, sentence, answer}], ${qMin}–${qMax} items. Each sentence contains "___" where its answer goes and never contains the answer itself; every answer is in wordBank.
- matching: pairs [{term, match}], 4–8 pairs. term ≤${LIMITS.term} chars, match ≤${LIMITS.text} chars (a definition, fact or word). Code shuffles the right column.
- sorting: categories (2–3 headings) + sortItems [{word, category}], 6–12 items, each word ≤${LIMITS.word} chars, each category used at least twice.
- labeling: subject (one concrete thing drawn large, e.g. "a sunflower plant") + labels [{word, clue}], 4–6 labels. The student writes the word from the word bank next to each numbered clue. A clue describes the part's job or look in words and never contains its word.
- table_fill: columns (2–4 headers) + rows (3–6 rows, each the same length as columns). A blank cell is written as its answer in square brackets, e.g. ["Cat", "4", "[8]"]. Every blank must follow from the rest of its row (a rule named in the header such as "Total" or "Double") or from a well-known fact. Optional: up to 3 questions that need the table (compare, total, difference) — never one whose answer is just a blank or a printed cell.
- shapes: shapeItems, 4–8 items drawn by code: {kind:"fraction", shape: circle|rectangle|bar, parts 2–12, shaded, ask: "name" (write the fraction) | "shade" (student shades it)}, {kind:"count", icon: ${CHART_ICONS.join('|')}, count 1–20}, {kind:"polygon", shape, ask: "sides" | "corners" | "name"}. Use ask "name" only for triangle, pentagon, hexagon, octagon or circle — a square is also a rectangle and a rhombus.
- chart: chart + questions (${qMin}–${qMax}). Picture graph (≤${CHART_LIMITS.pictograph.maxCategories} categories, values ≤${CHART_LIMITS.pictograph.maxValue}), bar graph (≤${CHART_LIMITS.bar.maxCategories} bars, values ≤${CHART_LIMITS.bar.maxValue}) or table (≤${CHART_LIMITS.table.maxCategories} rows); whole numbers; icon for picture graphs. Every question is answered by reading the chart. Never pie/line/double-bar graphs.
- activity_art: a colouring page. subject (one simple thing to colour) + instruction (one sentence, e.g. "Colour the picture.") + tasks (0–3 short lines, e.g. "Write the word moon three times."). Use it only when the page description is a colouring or drawing page.

Use the suggested layout unless the page description clearly fits another one. Crosswords, word searches, mazes and dot-to-dot are not possible — use matching, fill_blank or labeling on the same content.

THE PICTURE IS DECORATION ONLY. Each page gets one illustration from an AI that cannot count, spell or place details. So:
- Never refer to the picture/image/illustration/drawing, never ask what is "shown", never ask to count, find, circle or locate something in it, and never ask to colour a specific part or use a specific colour (no "Colour the rings yellow"). Counting is only allowed on shapes items and chart data, which code draws exactly.
- illustrationSubject: a concrete thing from the page topic (≤8 words) to draw, e.g. "a smiling orange pumpkin with a green stem" — never a table, chart, sign, word, number or letter.

Content rules:
- Every question, clue, blank and table cell has exactly ONE correct, checkable answer that is factually and academically correct. No opinion or guessing questions ("What do you think…", "Who is likely…"), no negative questions with several valid answers, no questions about the student's own drawing, collection, story or experience.
- Matching: every term has exactly one correct match and no match fits two terms. Sorting: every word clearly belongs to exactly one category.
- Use only words a ${plan.gradeLevel} student can read; avoid technical terms unless the page defines them.
- Answers are short: a word, number or short phrase.

Pages:
${pageList}

Call generate_layout_content with one entry per page above.`
}

// ── Normalize + repair + validate ────────────────────────────────────────────
const s = (v) => cleanText(v).trim()
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, ' ')
const has = (v) => v !== null && v !== undefined
const arr = (v) => (Array.isArray(v) ? v.filter(has) : [])
const dedupeBy = (list, key) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true }) }
const BLANK_RE = /_{2,}/

// Text a student reads that would depend on the decorative picture.
const PICTURE_DEPENDENT = [
  /\b(?:in|on|from|inside|at) (?:the|this|each) (?:picture|image|illustration|drawing|photo|art(?:work)?)\b/i,
  /\b(?:look|looking) (?:at|closely at) (?:the|this) (?:picture|image|illustration|drawing)\b/i,
  /\b(?:picture|image|illustration|drawing) (?:shows?|above|below|on (?:the|this) page)\b/i,
  /\b(?:shown|pictured|drawn) (?:above|below|here|in|on)\b/i,
  /\bhow many\b[^?]*\b(?:do you see|can you (?:see|find|count)|are (?:shown|pictured|drawn)|in the (?:picture|image|illustration))\b/i,
  /\b(?:count|circle|find|spot|point to|locate) the\b[^.?]*\b(?:picture|image|illustration|drawing)\b/i,
  /\b(?:colou?r|paint|shade) (?:the|its|each|every|all(?: the)?) [^.?!]*\b(?:red|orange|yellow|green|blue|purple|violet|pink|brown|black|grey|gray|gold|silver)\b/i,
]

// A questions / multiple-choice page prints only its questions: nothing may read a
// story, passage, list, row or numbered item that is not on the page.
const READS_MISSING = [
  /\baccording to the\b/i,
  /\b(?:the|this|that) (?:story|passage|poem|text|list|data|graph|chart|table|map|diagram|page)\b/i,
  /\b(?:sentence|section|row|item|card|example|box|step|column) (?:\d+|[A-H])\b/,
  /\b(?:first|second|third|fourth|fifth|last) (?:picture|image|word|row|column|box)\b/i,
]
/** True if a question reads something a questions page does not print. Pure — exported for unit testing. */
export const readsOtherPageContent = (q) => READS_MISSING.some(re => re.test(String(q ?? '')))

/** True if student-facing text depends on the decorative picture. Pure — exported for unit testing. */
export function isPictureDependent(text) {
  return PICTURE_DEPENDENT.some(re => re.test(String(text ?? '')))
}

/** Every student-facing string of a page's raw content, with a label for error messages. Pure. */
function studentTexts(layout, spec, questions) {
  const out = []
  const add = (label, t) => { if (s(t)) out.push([label, s(t)]) }
  for (const q of questions ?? []) { add(`q${q.num}`, q.question); for (const o of q.options ?? []) add(`q${q.num} option`, o) }
  if (layout === 'matching') spec.pairs?.forEach((p, i) => { add(`pair ${i + 1}`, p.term); add(`pair ${i + 1}`, p.match) })
  if (layout === 'labeling') spec.labels?.forEach((l, i) => add(`clue ${i + 1}`, l.clue))
  if (layout === 'activity_art') { add('instruction', spec.instruction); spec.tasks?.forEach((t, i) => add(`task ${i + 1}`, t)) }
  return out
}

const parseCell = (c) => {
  const t = s(c)
  const m = t.match(/^\[(.*)\]$/)
  return m ? { answer: s(m[1]) } : t
}

/**
 * Turn one raw Groq page into { layout, spec, questions, repairs }: null fields
 * dropped, strings trimmed, and cheap repairs (dedupe, truncate to the layout
 * limits, clamp shape counts, normalise multiple-choice answers to letters, build or
 * complete a fill-in word bank, put a blank into a fill-in sentence that prints its
 * answer). Pure — exported for unit testing.
 */
export function normalizeHybridPage(raw) {
  const repairs = []
  const layout = HYBRID_LAYOUTS.includes(raw?.layout) ? raw.layout : null
  const qs = arr(raw?.questions).map((q, i) => ({
    num: i + 1,
    question: s(q.question),
    answer: s(q.answer),
    ...(has(q.options) ? { options: arr(q.options).map(s).filter(Boolean) } : {}),
  }))
  let spec = {}
  let questions
  switch (layout) {
    case 'questions':
    case 'chart':
      questions = qs.map(({ options, ...q }) => q)
      if (layout === 'chart' && raw.chart && typeof raw.chart === 'object') {
        // "Mercury: 3" strings → { label, value }; null optional fields dropped.
        const cats = arr(raw.chart.categories).map(c => {
          if (typeof c !== 'string') return c
          const m = c.match(/^(.*?)[\s:=–-]+(\d+)\s*$/)
          return m ? { label: s(m[1]), value: Number(m[2]) } : { label: s(c), value: NaN }
        })
        const base = Object.fromEntries(Object.entries({ ...raw.chart, categories: cats }).filter(([, v]) => has(v) && v !== ''))
        const { chart, changed } = repairChart(base)
        if (changed && chart) repairs.push('chart outside the bar/picture-graph limits was drawn as a table')
        spec = { chart: chart ?? raw.chart }
      }
      break
    case 'multiple_choice': {
      const out = qs.slice(0, LIMITS.mcQuestions.max).map(q => {
        const options = dedupeBy(q.options ?? [], norm).map(o => o.replace(/^\(?[A-Da-d][).:]\s+/, ''))
        let answer = q.answer.replace(/^\(?([A-Da-d])[).:]\s+.*$/, '$1')
        const i = mcAnswerIndex({ options, answer })
        if (i >= 0) answer = LETTERS[i]
        return { num: q.num, question: q.question, options, answer }
      })
      spec = { questions: out }
      questions = out
      break
    }
    case 'fill_blank': {
      const sentences = arr(raw.sentences).map((x, i) => {
        let sentence = s(x.sentence)
        const answer = s(x.answer)
        if (!BLANK_RE.test(sentence) && answer) {
          const re = new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
          if (re.test(sentence)) { sentence = sentence.replace(re, '___'); repairs.push(`sentence ${i + 1}: answer replaced by a blank`) }
        }
        return { num: i + 1, question: sentence, answer }
      })
      let bank = dedupeBy(arr(raw.wordBank).map(s).filter(Boolean), norm)
      const missing = sentences.filter(q => q.answer && !bank.some(w => norm(w) === norm(q.answer)))
      if (missing.length) {
        bank = [...bank, ...missing.map(q => q.answer)]
        repairs.push(`${missing.length} answer(s) added to the word bank`)
      }
      bank = dedupeBy(bank, norm).sort((a, b) => a.localeCompare(b))
      spec = { wordBank: bank }
      questions = sentences
      break
    }
    case 'matching': {
      const pairs = dedupeBy(arr(raw.pairs).map(p => ({ term: s(p.term), match: s(p.match) })), p => `${norm(p.term)}|${norm(p.match)}`)
      if (pairs.length > LIMITS.pairs.max) repairs.push(`matching trimmed to ${LIMITS.pairs.max} pairs`)
      spec = { pairs: pairs.slice(0, LIMITS.pairs.max) }
      break
    }
    case 'sorting': {
      const categories = dedupeBy(arr(raw.categories).map(s).filter(Boolean), norm)
      const items = dedupeBy(arr(raw.sortItems ?? raw.items).map(it => {
        const cat = categories.find(c => norm(c) === norm(it.category))
        return { word: s(it.word), category: cat ?? s(it.category) }
      }), it => norm(it.word))
      if (items.length > LIMITS.items.max) repairs.push(`sorting trimmed to ${LIMITS.items.max} items`)
      spec = { categories, items: items.slice(0, LIMITS.items.max) }
      break
    }
    case 'labeling': {
      const labels = dedupeBy(arr(raw.labels).map(l => ({ word: s(l.word), clue: s(l.clue) })), l => norm(l.word))
      if (labels.length > LIMITS.labels.max) repairs.push(`labeling trimmed to ${LIMITS.labels.max} labels`)
      spec = { subject: s(raw.subject) || s(raw.illustrationSubject), labels: labels.slice(0, LIMITS.labels.max) }
      break
    }
    case 'table_fill': {
      const rows = arr(raw.rows).map(r => arr(r).map(parseCell))
      if (rows.length > LIMITS.rows.max) repairs.push(`table trimmed to ${LIMITS.rows.max} rows`)
      spec = { columns: arr(raw.columns).map(s), rows: rows.slice(0, LIMITS.rows.max) }
      const tq = qs.map(({ options, ...q }) => q)
      if (tq.length) spec.questions = tq
      break
    }
    case 'shapes': {
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))))
      const items = arr(raw.shapeItems ?? raw.items).slice(0, LIMITS.shapes.max).map(it => {
        if (it.kind === 'fraction') {
          const parts = clamp(it.parts ?? 4, LIMITS.parts.min, LIMITS.parts.max)
          const ask = it.ask === 'shade' ? 'shade' : 'name'
          return { kind: 'fraction', shape: FRACTION_SHAPES.includes(it.shape) ? it.shape : 'circle', parts, shaded: clamp(it.shaded ?? 1, ask === 'shade' ? 1 : 0, parts), ask }
        }
        if (it.kind === 'count') return { kind: 'count', icon: CHART_ICONS.includes(it.icon) ? it.icon : 'star', count: clamp(it.count ?? 1, LIMITS.count.min, LIMITS.count.max) }
        if (it.kind === 'polygon') {
          const shape = it.shape
          const ask = shape === 'circle' ? 'name' : (['sides', 'corners', 'name'].includes(it.ask) ? it.ask : 'sides')
          return { kind: 'polygon', shape, ask }
        }
        return { kind: it.kind }
      })
      spec = { items }
      break
    }
    case 'activity_art': {
      const tasks = arr(raw.tasks).map(s).filter(Boolean).slice(0, LIMITS.tasks.max)
      spec = { subject: s(raw.subject) || s(raw.illustrationSubject), instruction: s(raw.instruction) || 'Colour the picture.', ...(tasks.length ? { tasks } : {}) }
      break
    }
    default:
      break
  }
  return { layout, spec, questions, repairs }
}

/**
 * Validate a normalized page. Returns a list of issues ([] = shippable). Checks the
 * layout's spec (specs.js / validateChart), question counts, the picture-dependence
 * and open-ended rules, and — given a plan — that the page fits (dry render). Pure.
 */
export function validateHybridPage(norm_, { packageType = 'small', plan = null, page = null } = {}) {
  const { layout, spec, questions } = norm_
  if (!layout) return ['layout missing or not one of the allowed layouts']
  const issues = []
  const [qMin] = questionRange(packageType)
  const minQ = Math.max(3, qMin - 1)
  if (layout === 'questions' || layout === 'fill_blank' || layout === 'chart') {
    if (!questions?.length) issues.push('no questions')
    else if (questions.length < minQ) issues.push(`only ${questions.length} questions (min ${minQ})`)
    for (const q of questions ?? []) {
      if (!q.question) issues.push(`q${q.num} empty question`)
      if (!q.answer) issues.push(`q${q.num} empty answer`)
    }
    if (layout === 'fill_blank') {
      for (const q of questions ?? []) if (!BLANK_RE.test(q.question)) issues.push(`sentence ${q.num} has no ___ blank`)
      if (spec.wordBank.some(w => w.length > LIMITS.word)) issues.push(`word bank entries must be ≤${LIMITS.word} chars`)
    }
    if (layout === 'chart') {
      if (!spec.chart) issues.push('chart missing')
      else for (const i of validateChart(spec.chart)) issues.push(i)
    }
  } else {
    issues.push(...validateLayoutSpec(layout, spec))
    if (layout === 'multiple_choice' && spec.questions?.length < minQ) issues.push(`only ${spec.questions.length} questions (min ${minQ})`)
  }
  const asked = layout === 'multiple_choice' ? spec.questions : layout === 'table_fill' ? spec.questions : questions
  for (const q of asked ?? []) if (isOpenEndedQuestion(q.question)) issues.push(`q${q.num} is open-ended (no single answer)`)
  // A questions / multiple-choice page prints only its questions, so none may read a
  // story, list, row or icon that is not on the page.
  if (layout === 'questions' || layout === 'multiple_choice') {
    for (const q of asked ?? []) if (readsOtherPageContent(q.question)) issues.push(`q${q.num} refers to something not printed on the page (a story, list, row or icon): "${q.question.slice(0, 80)}"`)
  }
  if (layout !== 'chart' && layout !== 'shapes') {
    for (const [label, t] of studentTexts(layout, spec, asked)) if (isPictureDependent(t)) issues.push(`${label} depends on the picture: "${t.slice(0, 80)}"`)
  }
  if (!issues.length && plan && page && layout !== 'chart') {
    try {
      renderLayout(layout, plan, { ...page, content: { title: page.title, questions } }, layout === 'fill_blank' ? { wordBank: spec.wordBank } : spec, { art: null })
    } catch (err) {
      if (err instanceof LayoutOverflowError) issues.push('content too long for one page — use fewer or shorter items')
      else issues.push(`layout error: ${err.message}`)
    }
  }
  return issues
}

const PRINTED_SUBJECT = /\b(?:tables?|charts?|graphs?|worksheets?|numbers?|numerals?|digits?|letters?|alphabet|words?|text|labels?|signs?|posters?|equations?|fractions?|diagrams?)\b/i

/**
 * The page.content a validated hybrid page carries. `questions` is what the answer
 * key prints: the page's own Q&A for questions/fill_blank/chart, otherwise derived
 * from the spec by layoutAnswerKey. Pure.
 */
export function hybridPageContent(raw, n) {
  const title = s(raw.title)
  // A subject that would make FLUX draw text or data ("a table with numbers") is dropped;
  // pageIllustrationSubject then derives one from the page description.
  const subj = s(raw.illustrationSubject)
  const illustrationSubject = subj && !PRINTED_SUBJECT.test(subj) ? subj : undefined
  const base = { title, layout: n.layout, ...(illustrationSubject ? { illustrationSubject } : {}) }
  if (n.layout === 'chart') return { ...base, chart: n.spec.chart, questions: n.questions }
  if (n.layout === 'questions') return { ...base, spec: {}, questions: n.questions }
  if (n.layout === 'fill_blank') return { ...base, spec: n.spec, questions: n.questions }
  return { ...base, spec: n.spec, questions: layoutAnswerKey(n.layout, n.spec) }
}

/**
 * Fallback for a page whose layout never validated: a `questions` page from any
 * plain Q&A the attempts produced (multiple-choice stems with their answer text,
 * table questions, …), or null. Pure.
 */
export function questionsFallback(attempts, opts) {
  for (const n of attempts) {
    const src = n.layout === 'multiple_choice'
      ? (n.spec.questions ?? []).map(q => {
        // The option text when the question itself is a valid choice, else a written answer.
        const valid = (q.options?.length ?? 0) >= 2 && mcAnswerIndex(q) >= 0
        return { num: q.num, question: q.question, answer: valid ? q.options[mcAnswerIndex(q)] : (/^[A-D]$/.test(q.answer) ? '' : q.answer) }
      })
      : n.layout === 'table_fill' ? (n.spec.questions ?? []) : (n.layout === 'questions' ? n.questions : [])
    const questions = (src ?? []).filter(q => q.question && q.answer && !BLANK_RE.test(q.question)).map((q, i) => ({ num: i + 1, question: q.question, answer: q.answer }))
    const cand = { layout: 'questions', spec: {}, questions, repairs: [] }
    if (questions.length && validateHybridPage(cand, opts).length === 0) return cand
  }
  return null
}

// ── Groq calls ───────────────────────────────────────────────────────────────
/** Ask Groq for a chunk of pages. Returns raw pages[] or null on failure. */
async function fetchHybridChunk(plan, pages, feedback, stats) {
  const t0 = Date.now()
  try {
    const res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: HYBRID_MAX_TOKENS,
      tool: hybridContentTool,
      messages: [{ role: 'user', content: buildHybridContentPrompt(plan, pages, feedback) }],
      label: 'Groq hybrid content',
      step: 'content',
    })
    stats?.calls.push({ pages: pages.length, ms: Date.now() - t0, usage: res.usage ?? null, ok: !!res.args })
    return Array.isArray(res.args?.pages) ? res.args.pages : null
  } catch (err) {
    stats?.calls.push({ pages: pages.length, ms: Date.now() - t0, error: err.status ?? err.message, code: err.error?.code ?? err.code })
    console.warn(`hybrid content for pages ${pages.map(p => p.pageNum).join(',')} failed (${err.status ?? err.message}${err.status ? ` ${JSON.stringify(err.error ?? '').slice(0, 200)}` : ''})`)
    return null
  }
}

/**
 * Generate structured content for every worksheet/activity page. Returns
 * { pages: Map(pageNum → content), failed: page[], log } — `failed` pages need the
 * legacy fallback. `fetchChunk` is injectable for tests and the live eval.
 */
export async function generateHybridPages(plan, contentPages, { fetchChunk = fetchHybridChunk, stats = null } = {}) {
  const opts = (page) => ({ packageType: plan.packageType, plan, page: { ...page, title: page.title } })
  const done = new Map()
  const attempts = new Map(contentPages.map(p => [p.pageNum, []]))
  let pending = contentPages
  const feedback = new Map()
  const missing = new Set()

  for (let attempt = 1; attempt <= HYBRID_MAX_ATTEMPTS && pending.length; attempt++) {
    // Pages whose whole call failed (e.g. 400 tool_use_failed) are retried one per call,
    // so one malformed page cannot sink its neighbours again.
    const lost = pending.filter(p => missing.has(p.pageNum))
    const groups = [...chunk(pending.filter(p => !missing.has(p.pageNum)), HYBRID_PAGES_PER_CALL), ...chunk(lost, 1)]
    missing.clear()
    const results = await mapWithConcurrency(groups, recheckConcurrency(), g => fetchChunk(plan, g, feedback, stats))
    const next = []
    groups.forEach((group, gi) => {
      const raws = results[gi] ?? []
      for (const page of group) {
        const raw = raws.find(r => r?.pageNum === page.pageNum)
        if (!raw) {
          feedback.set(page.pageNum, ['the page was missing from your answer'])
          missing.add(page.pageNum)
          stats?.pages.push({ pageNum: page.pageNum, attempt, layout: null, issues: ['missing'] })
          next.push(page)
          continue
        }
        const n = normalizeHybridPage(raw)
        const issues = validateHybridPage(n, opts({ ...page, title: s(raw.title) }))
        attempts.get(page.pageNum).push({ ...n, raw })
        stats?.pages.push({ pageNum: page.pageNum, attempt, layout: n.layout, issues, repairs: n.repairs, raw })
        if (issues.length === 0) {
          done.set(page.pageNum, { content: hybridPageContent(raw, n), repairs: n.repairs })
        } else {
          console.warn(`hybrid content p${page.pageNum} (${n.layout}, attempt ${attempt}/${HYBRID_MAX_ATTEMPTS}): ${issues.join('; ')}`)
          feedback.set(page.pageNum, issues.slice(0, 6))
          next.push(page)
        }
      }
    })
    pending = next
  }

  const failed = []
  for (const page of pending) {
    const tried = attempts.get(page.pageNum)
    const fb = questionsFallback(tried, opts({ ...page, title: s(tried[0]?.raw?.title) }))
    if (fb) {
      const raw = tried[0].raw
      done.set(page.pageNum, { content: hybridPageContent({ ...raw, layout: 'questions' }, fb), repairs: [], fallback: 'questions' })
      addReviewNote('fallback', `p${page.pageNum}: ${tried[0].layout ?? 'structured'} content never validated — printed as plain questions instead`)
    } else {
      failed.push(page)
    }
  }
  return { pages: done, failed }
}

// ── Structured recheck ───────────────────────────────────────────────────────
const hybridValidateTool = {
  type: 'function',
  function: {
    name: 'validate_content',
    description: 'Validate and correct worksheet items for academic accuracy',
    parameters: {
      type: 'object',
      properties: {
        pass: { type: 'boolean' },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              questionNum: { type: 'integer' },
              correctedAnswer: { type: 'string' },
              correctedQuestion: orNull({ type: 'string', description: 'Only for items marked rewritable: the rewritten question when the original is ambiguous or opinion-based' }),
              reason: { type: 'string' },
            },
            required: ['pageNum', 'questionNum', 'correctedAnswer', 'reason'],
          },
        },
      },
      required: ['pass', 'corrections'],
    },
  },
}

/**
 * What the recheck sees for one hybrid page: numbered { num, question, answer }
 * items plus a `ref` (how to apply a correction). shapes / activity_art have no
 * model-written answers (shapes answers are computed) and are skipped. Pure.
 */
export function recheckItems(content) {
  const sp = content.spec ?? {}
  const items = []
  const add = (question, answer, ref, rewritable = false) => items.push({ num: items.length + 1, question, answer, ref, rewritable })
  switch (content.layout) {
    case 'questions':
    case 'chart':
      content.questions.forEach((q, i) => add(q.question, q.answer, { i }, true)); break
    case 'fill_blank':
      content.questions.forEach((q, i) => add(`${q.question} (word bank: ${sp.wordBank.join(', ')})`, q.answer, { i })); break
    case 'multiple_choice':
      sp.questions.forEach((q, i) => add(`${q.question} Options: ${q.options.map((o, j) => `${LETTERS[j]}) ${o}`).join(' ')}`, `${LETTERS[mcAnswerIndex(q)]}) ${q.options[mcAnswerIndex(q)]}`, { i })); break
    case 'matching':
      sp.pairs.forEach((p, i) => add(`Match: ${p.term} (choices: ${sp.pairs.map(x => x.match).join(' | ')})`, p.match, { i })); break
    case 'sorting':
      sp.items.forEach((it, i) => add(`Sort "${it.word}" into: ${sp.categories.join(' / ')}`, it.category, { i })); break
    case 'labeling':
      sp.labels.forEach((l, i) => add(`Which part of ${sp.subject}? ${l.clue} (word bank: ${sp.labels.map(x => x.word).join(', ')})`, l.word, { i })); break
    case 'table_fill':
      sp.rows.forEach((r, i) => r.forEach((c, j) => {
        if (c && typeof c === 'object') add(`Table [${sp.columns.join(' | ')}], row: ${r.map((x, k) => (k === j ? '___' : x && typeof x === 'object' ? `[${x.answer}]` : x)).join(' | ')}`, c.answer, { cell: [i, j] })
      }))
      ;(sp.questions ?? []).forEach((q, i) => add(q.question, q.answer, { tq: i }, true))
      break
    default:
      break
  }
  return items
}

/** Recheck one chunk of hybrid pages (Groq). Returns the validation args or null. */
async function recheckHybridPages(plan, pages) {
  const view = pages.map(p => ({
    pageNum: p.pageNum,
    layout: p.content.layout,
    ...(p.content.layout === 'chart' ? { chart: p.content.chart } : {}),
    items: recheckItems(p.content).map(({ ref, ...it }) => it),
  }))
  const prompt = `You are an academic fact-checker for elementary school worksheets.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Each page is typeset by code; its only picture is decoration. Review every item below. For each item check:
1. The answer is academically correct (math, spelling, grammar, facts) and answers its item specifically.
2. The item has exactly ONE correct answer. For matching, word-bank, sorting and multiple-choice items, the answer must be the only fitting choice among those listed.
3. On chart pages the answer must match the chart data exactly.
4. The wording suits ${plan.gradeLevel}.
If an answer is wrong, return correctedAnswer — for multiple choice the correct option letter, for matching the correct match text from the choices, for sorting the correct category, for labeling the correct word from the word bank, for word-bank sentences a word from the word bank.
Only items with "rewritable": true may get a correctedQuestion (when the question is ambiguous, opinion-based or has several answers); never rewrite a question so that it refers to the picture or to the page layout.
Do not return corrections for items that are fine.

${JSON.stringify(view, null, 1)}

Call validate_content with your assessment.`
  try {
    const res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: 4096,
      tool: hybridValidateTool,
      messages: [{ role: 'user', content: prompt }],
      label: 'Groq hybrid validate',
      step: 'content_recheck',
    })
    return res.args ?? null
  } catch (err) {
    console.warn(`hybrid recheck of pages ${pages.map(p => p.pageNum).join(',')} failed (${err.status ?? err.message})`)
    return null
  }
}

/**
 * Apply recheck corrections to one hybrid page's content. Each correction must keep
 * the spec valid (answer ∈ options / word bank / categories, matching stays a
 * bijection — a match moved onto another term swaps the two) and a rewritten
 * question must not depend on the picture or the page layout; otherwise it is
 * reverted with a spec_mismatch review note. Returns the new content. Pure apart
 * from review notes/logging — exported for unit testing.
 */
export function applyHybridCorrections(pageNum, content, corrections, opts = {}) {
  if (!corrections?.length) return content
  const items = recheckItems(content)
  let c = structuredClone(content)
  for (const fix of corrections) {
    const item = items.find(it => it.num === fix.questionNum)
    if (!item) continue
    const answer = s(fix.correctedAnswer)
    const rewrite = item.rewritable ? s(fix.correctedQuestion) : ''
    if (!answer && !rewrite) continue
    if (!rewrite && norm(answer) === norm(item.answer)) continue
    if (rewrite && (isLayoutQuestion(rewrite) || isPictureDependent(rewrite) || isOpenEndedQuestion(rewrite))) {
      addReviewNote('spec_mismatch', `p${pageNum} item ${item.num}: the recheck's rewrite "${rewrite}" refers to the picture/layout or has no single answer, so the original was kept — check: "${item.question}" → ${item.answer}`)
      continue
    }
    const next = structuredClone(c)
    const sp = next.spec
    const r = item.ref
    let ok = true
    switch (next.layout) {
      case 'questions': case 'chart':
        next.questions[r.i] = { ...next.questions[r.i], ...(rewrite ? { question: rewrite } : {}), answer: answer || next.questions[r.i].answer }; break
      case 'fill_blank':
        ok = sp.wordBank.some(w => norm(w) === norm(answer))
        if (ok) next.questions[r.i] = { ...next.questions[r.i], answer: sp.wordBank.find(w => norm(w) === norm(answer)) }
        break
      case 'multiple_choice': {
        const q = sp.questions[r.i]
        const i = mcAnswerIndex({ options: q.options, answer: answer.replace(/^\(?([A-Da-d])[).:]?(\s+.*)?$/, '$1') })
        ok = i >= 0
        if (ok) q.answer = LETTERS[i]
        break
      }
      case 'matching': {
        const j = sp.pairs.findIndex(p => norm(p.match) === norm(answer))
        if (j >= 0) [sp.pairs[r.i].match, sp.pairs[j].match] = [sp.pairs[j].match, sp.pairs[r.i].match]
        else ok = false
        break
      }
      case 'sorting': {
        const cat = sp.categories.find(x => norm(x) === norm(answer))
        if (cat) sp.items[r.i].category = cat
        else ok = false
        break
      }
      case 'labeling': {
        const j = sp.labels.findIndex(l => norm(l.word) === norm(answer))
        if (j >= 0) [sp.labels[r.i].word, sp.labels[j].word] = [sp.labels[j].word, sp.labels[r.i].word]
        else ok = false
        break
      }
      case 'table_fill':
        if (r.cell) sp.rows[r.cell[0]][r.cell[1]] = { answer }
        else sp.questions[r.tq] = { ...sp.questions[r.tq], ...(rewrite ? { question: rewrite } : {}), answer: answer || sp.questions[r.tq].answer }
        break
      default:
        ok = false
    }
    const n = { layout: next.layout, spec: next.layout === 'chart' ? { chart: next.chart } : sp, questions: next.questions, repairs: [] }
    const issues = ok ? validateHybridPage(n, opts) : ['correction is not one of the page\'s choices']
    if (issues.length) {
      addReviewNote('spec_mismatch', `p${pageNum} item ${item.num}: the recheck's correction "${answer}" (${fix.reason}) does not fit the page (${issues[0]}), so it was not applied — check: "${item.question}" → ${item.answer}`)
      continue
    }
    if (!['questions', 'fill_blank', 'chart'].includes(next.layout)) next.questions = layoutAnswerKey(next.layout, sp)
    c = next
    if (rewrite) addReviewNote('question_rewritten', `p${pageNum} item ${item.num}: "${item.question}" → "${rewrite}" (answer: ${answer || item.answer})`)
    else addReviewNote('answer_corrected', `p${pageNum} item ${item.num} "${item.question}": ${item.answer} → ${answer}`)
    console.log(`  p${pageNum} item ${item.num}: "${item.answer}" → "${answer}" (${fix.reason})`)
  }
  return c
}

/**
 * Recheck all hybrid pages (chunks of RECHECK_PAGES_PER_CALL, sequential by default,
 * a failed chunk split in halves) and apply the corrections. `check` is injectable.
 * @param {Array<{ pageNum, content }>} pages
 */
export async function recheckHybridContent(plan, pages, { check = recheckHybridPages, optsFor = () => ({}) } = {}) {
  const checkable = pages.filter(p => recheckItems(p.content).length)
  if (!checkable.length) return pages
  const groups = chunk(checkable, RECHECK_PAGES_PER_CALL)
  const results = await mapWithConcurrency(groups, recheckConcurrency(), g => recheckWithSplit(plan, g, check))
  const unchecked = results.flatMap(r => r.unchecked)
  if (unchecked.length) addReviewNote('fallback', `Q&A recheck failed for page(s) ${unchecked.join(', ')} — their answers were NOT double-checked`)
  const corrections = results.flatMap(r => r.validation?.corrections ?? [])
  if (corrections.length) console.log(`Hybrid content accuracy: ${corrections.length} correction(s) proposed`)
  return pages.map(p => {
    const mine = corrections.filter(c => c.pageNum === p.pageNum)
    return mine.length ? { ...p, content: applyHybridCorrections(p.pageNum, p.content, mine, optsFor(p)) } : p
  })
}

// ── Orchestration ────────────────────────────────────────────────────────────
/**
 * Hybrid content for every worksheet/activity page: structured layouts (validated,
 * rechecked) plus legacy content for pages that never validated. Returns a Map
 * pageNum → page.content. Deps injectable for tests: fetchChunk (Groq content),
 * check (Groq recheck), legacy (async (plan, pages) → [{ pageNum, ...legacyContent }]).
 */
export async function generateHybridContent(plan, contentPages, { fetchChunk, check, legacy, stats } = {}) {
  const { pages, failed } = await generateHybridPages(plan, contentPages, { fetchChunk, stats })
  for (const [pn, v] of pages) v.repairs.forEach(r => console.log(`  p${pn}: repaired — ${r}`))
  const byNum = new Map(contentPages.map(p => [p.pageNum, p]))
  let structured = [...pages].map(([pageNum, v]) => ({ pageNum, content: v.content }))
  structured = await recheckHybridContent(plan, structured, {
    check,
    optsFor: (p) => ({ packageType: plan.packageType, plan, page: { ...byNum.get(p.pageNum), title: p.content.title } }),
  })
  const out = new Map(structured.map(p => [p.pageNum, p.content]))
  if (failed.length) {
    const nums = failed.map(p => p.pageNum).join(', ')
    console.warn(`hybrid content: page(s) ${nums} never produced a valid layout — using the legacy content prompt`)
    addReviewNote('fallback', `p${nums}: no valid hybrid layout after ${HYBRID_MAX_ATTEMPTS} attempts — legacy content used (P1 classifier or gpt-image-2 draws the page)`)
    const legacyPages = legacy ? await legacy(plan, failed) : []
    for (const lp of legacyPages ?? []) { const { pageNum, ...content } = lp; out.set(pageNum, content) }
  }
  console.log(`Hybrid content: ${structured.length} structured page(s) [${structured.map(p => `${p.pageNum}:${p.content.layout}`).join(' ')}], ${failed.length} legacy`)
  return out
}
