// Groq content for PAGE_RENDERER=hybrid: one structured layout spec per
// worksheet/activity page, drawn entirely by the layout engine (src/lib/layout/).
// There is no imageSpec: the only picture on a page is a decorative FLUX
// illustration, so no question, clue or task may depend on it. Answer keys are
// derived in code from each spec (layoutAnswerKey), so they always match the page.
//
// Flow per set: suggestLayout (code hint) → Groq in chunks of HYBRID_PAGES_PER_CALL
// pages → normalize + repair + strict validation (+ a dry render for overflow; +
// matching/sorting ambiguity checks, and a Groq self-check per matching page) →
// failed pages are re-asked with their errors (HYBRID_MAX_ATTEMPTS) → a page that
// still fails falls back to the `questions` layout built from any valid plain Q&A
// it produced, or else to the legacy content prompt (imageSpec + questions), which
// the router sends to the P1/P2 classifier or gpt-image-2. Then a structured Groq
// recheck verifies the answers. The legacy path (generate-content.js) is untouched.
import { groq } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'
import { addReviewNote } from '../lib/review-notes.js'
import { isHybridOnly } from '../config/renderer.js'
import { validateLayoutSpec, layoutAnswerKey, matchingOrder, LIMITS, POLYGONS, FRACTION_SHAPES, LETTERS, mcAnswerIndex } from '../lib/layout/specs.js'
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
// List fields also accept an object: gpt-oss sometimes writes a list keyed by index
// or num ({"1": {...}, "2": {...}}); toList turns it back into an array.
const orNull = (s) => {
  const typed = looseEnums(s)
  const { description, ...rest } = typed
  const alts = [rest, { type: 'null' }, { type: 'string' }]
  if (rest.type === 'array') alts.push({ type: 'object' })
  return { ...(description ? { description } : {}), anyOf: alts }
}
// Item numbers are optional and may be strings: code renumbers by position, and a
// missing or "1" num must never fail the whole call (400 tool_use_failed).
const itemNum = { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] }
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
              // Optional: a page without pageNum failed the whole call (400 tool_use_failed);
              // matchRawPages pairs it with its planned page by position.
              pageNum: itemNum,
              title: orNull({ type: 'string' }),
              // Described, not enforced: an unknown layout must not fail the whole call;
              // matchRawPages infers it from the fields instead.
              layout: orNull({ type: 'string', enum: HYBRID_LAYOUTS }),
              illustrationSubject: orNull({ type: 'string', description: 'decorative picture: concrete noun phrase, max 8 words, no text' }),
              questions: orNull({
                type: 'array',
                description: 'questions / multiple_choice / chart; optional extra questions on table_fill',
                items: {
                  type: 'object',
                  properties: {
                    num: itemNum,
                    question: { type: 'string' },
                    options: strArr('multiple_choice only: 2–4 choices'),
                    answer: { type: 'string' },
                  },
                  required: ['question', 'answer'],
                },
              }),
              wordBank: strArr('fill_blank'),
              sentences: orNull({
                type: 'array',
                description: 'fill_blank: sentence with ___ where the answer goes',
                items: { type: 'object', properties: { num: itemNum, sentence: { type: 'string' }, answer: { type: 'string' } }, required: ['sentence', 'answer'] },
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
                  // Every key nullable: a chart field written as null/"" on any page
                  // must never fail the whole call; validateChart enforces chart pages.
                  type: orNull({ type: 'string', enum: CHART_TYPES }),
                  title: orNull({ type: 'string' }),
                  icon: orNull({ type: 'string', enum: CHART_ICONS }),
                  unit: orNull({ type: 'string' }),
                  labelHeader: orNull({ type: 'string' }),
                  valueHeader: orNull({ type: 'string' }),
                  // value may arrive as "4" or 4.0: normalizeChart reads it; a strict
                  // integer here failed the whole call (400 tool_use_failed).
                  categories: orNull({
                    type: 'array',
                    items: { anyOf: [{ type: 'object', properties: { label: { type: 'string' }, value: { anyOf: [{ type: 'integer' }, { type: 'number' }, { type: 'string' }] } }, required: ['label', 'value'] }, { type: 'string' }] },
                  }),
                },
                // No required keys: gpt-oss writes `chart: {}` on non-chart pages, and a
                // required key there fails the whole call (400 tool_use_failed).
                // validateChart checks chart pages.
              }),
            },
            // No required keys: gpt-oss omitted title/layout (and sometimes `pages`
            // itself), and Groq then rejected the whole call (400 tool_use_failed).
            // coercePages / matchRawPages default the title and infer the layout.
          },
        },
      },
    },
  },
}

// ── Layout hint ──────────────────────────────────────────────────────────────
// First match wins. "fraction" is a topic, not a format: on its own it used to send
// every fractions page (matching, multiple choice, number line, word problems) to
// `shapes`, so it is the last, weakest hint; explicit format words come first. No
// layout draws a number line (and word problems are text): those go to `questions`.
const HINTS = [
  ['chart', /\b(picture graph|pictograph|bar graph|tally (chart|marks)|graph)\b/i],
  ['shapes', /\b(shade|shaded|shading|polygons?|shapes?|sides|corners|vertices|count the)\b/i],
  ['matching', /\b(match(es|ing)?|connect|draw a line|pair)\b/i],
  ['sorting', /\b(sort(ing)?|classify|categor(y|ies|ize)|group the|columns? for)\b/i],
  ['questions', /\b(number lines?|word problems?|story problems?)\b/i],
  ['labeling', /\b(label(l?ing|l?ed)?|diagram|parts of)\b/i],
  ['table_fill', /\b(table|chart to complete|fill in the chart)\b/i],
  ['activity_art', /\b(colou?r(ing)?|draw and|trace)\b/i],
  ['fill_blank', /\b(fill[- ]in|blanks?|word bank|complete the sentences?|missing word)\b/i],
  ['multiple_choice', /\b(multiple[- ]choice|quiz|true or false|true\/false|circle the correct)\b/i],
  ['shapes', /\b(fractions?|fraction (?:strips|bars|circles|models))\b/i],
]

/** Layout suggested by the brainstorm page description (keyword hint; Groq may override). Pure. */
export function suggestLayout(page) {
  return hintedLayouts(page)[0]
}

const pageText = (page) => `${page?.filename ?? ''} ${page?.imagePrompt ?? ''}`.replace(/[-_]+/g, ' ')
/** Every layout the page description hints at, in HINTS order ('questions' when none). Pure. */
export function hintedLayouts(page) {
  const text = pageText(page)
  const hits = HINTS.filter(([, re]) => re.test(text)).map(([l]) => l)
  return hits.length ? [...new Set(hits)] : ['questions']
}

// ── Layout variety ───────────────────────────────────────────────────────────
// A live Grade 4 fractions set had 9 of 16 pages on `shapes` (every "fraction" page
// was hinted there), mostly the same drill. No layout may take more than
// LAYOUT_CAP_SHARE of a set's content pages (at least LAYOUT_CAP_MIN); `chart` is
// exempt (a graphing set is mostly charts and each chart has its own data).
export const LAYOUT_CAP_SHARE = 0.4
export const LAYOUT_CAP_MIN = 3
const CAP_EXEMPT = new Set(['chart'])
// Where surplus pages go: text layouts that can carry any topic.
const SURPLUS_LAYOUTS = ['multiple_choice', 'fill_blank', 'matching', 'questions', 'sorting', 'table_fill']
export const layoutCap = (n) => Math.max(LAYOUT_CAP_MIN, Math.floor(n * LAYOUT_CAP_SHARE))

/** Least-used surplus layout still under the cap (ties → SURPLUS_LAYOUTS order). Pure. */
export function surplusLayout(counts, cap, exclude = null) {
  const open = SURPLUS_LAYOUTS.filter(l => l !== exclude && (counts.get(l) ?? 0) < cap)
  const pool = open.length ? open : SURPLUS_LAYOUTS.filter(l => l !== exclude)
  return pool.reduce((best, l) => ((counts.get(l) ?? 0) < (counts.get(best) ?? 0) ? l : best), pool[0])
}

/**
 * Suggested layout per content page (Map pageNum → layout), in page order: the first
 * hinted layout still under the cap, else the least-used surplus layout. Pure and
 * deterministic.
 */
export function assignLayouts(pages = []) {
  const cap = layoutCap(pages.length)
  const counts = new Map()
  const out = new Map()
  for (const p of pages) {
    const hinted = hintedLayouts(p)
    const pick = hinted.find(l => CAP_EXEMPT.has(l) || (counts.get(l) ?? 0) < cap) ?? surplusLayout(counts, cap)
    counts.set(pick, (counts.get(pick) ?? 0) + 1)
    out.set(p.pageNum, pick)
  }
  return out
}

// ── Topic fit ────────────────────────────────────────────────────────────────
// Polygon items (name / sides / corners) belong only on a shapes/geometry page: a
// live fractions set printed "Fraction Number Line Equivalence" as two "What is the
// name of this shape?" items (circle, triangle). Decided from the PLAN page (not
// Groq's own title, which could be retitled to fit) and the set title/subject.
const GEOMETRY_TOPIC = /\b(geometry|geometric|shapes?|polygons?|[23][- ]?d|two[- ]dimensional|three[- ]dimensional|sides|corners|vertex|vertices|angles?|quadrilaterals?|triangles?|pentagons?|hexagons?|octagons?)\b/i
const STRONG_GEOMETRY = /\b(geometry|geometric|polygons?|[23][- ]?d shapes?|quadrilaterals?|sides|corners|vertices)\b/i
const FRACTION_TOPIC = /\bfractions?\b/i

/** May a page draw polygon items (name a shape, count sides/corners)? Pure. */
export function polygonsFitTopic(plan, page) {
  const p = pageText(page)
  if (FRACTION_TOPIC.test(p) && !STRONG_GEOMETRY.test(p)) return false
  if (GEOMETRY_TOPIC.test(p)) return true
  const set = `${plan?.setTitle ?? ''} ${plan?.subject ?? ''}`
  return GEOMETRY_TOPIC.test(set) && !(FRACTION_TOPIC.test(set) && !STRONG_GEOMETRY.test(set))
}

// Same minimum as the text layouts' smallest (3) would leave a shapes page mostly
// empty; the prompt asks for 4–8.
export const SHAPES_MIN_ITEMS = 4

// ── Title fit ────────────────────────────────────────────────────────────────
// The printed subtitle is the content title. A title may not promise something the
// layout does not print: a live set titled pages "Number Line …" and "… Word
// Problems" over shape-naming drills. Offending phrases are removed in code (no
// retry, no tokens) and the layout's own name is appended.
const TITLE_CLAIMS = [
  // No layout draws a number line.
  [/\bnumber[- ]lines?\b/gi, () => false],
  [/\b(?:word|story) problems?\b/gi, (l) => ['questions', 'multiple_choice', 'fill_blank'].includes(l)],
  [/\b(?:visual )?models?\b|\b(?:fraction )?(?:strips?|tiles?)\b|\bshad(?:e|ed|ing)\b|\bvisual\b/gi, (l) => l === 'shapes'],
  [/\bmultiple[- ]choice\b|\bquiz\b/gi, (l) => l === 'multiple_choice'],
  [/\bmatch(?:ing)?\b/gi, (l) => l === 'matching'],
  [/\bsort(?:ing)?\b/gi, (l) => l === 'sorting'],
  [/\bfill[- ]?ins?\b|\bfill in the blanks?\b/gi, (l) => l === 'fill_blank'],
  [/\blabel(?:l?ing)?\b/gi, (l) => l === 'labeling'],
  [/\b(?:picture |bar )?graphs?\b|\bpictographs?\b/gi, (l) => l === 'chart'],
  [/\bcolou?r(?:ing)?(?: page)?\b/gi, (l) => l === 'activity_art'],
]
function layoutNoun(layout, spec) {
  if (layout === 'shapes') {
    const kinds = new Set((spec?.items ?? []).map(i => i.kind))
    return kinds.size === 1 && kinds.has('fraction') ? 'Fraction Models' : kinds.size === 1 && kinds.has('count') ? 'Counting' : 'Shapes'
  }
  return { questions: 'Practice', multiple_choice: 'Multiple Choice', fill_blank: 'Fill-In', matching: 'Matching', sorting: 'Sort', labeling: 'Labeling', table_fill: 'Table', chart: 'Graph', activity_art: 'Colouring Page' }[layout] ?? 'Practice'
}

/** The page title with claims its layout does not deliver removed (+ the layout's name). Pure. */
export function fitPageTitle(title, layout, spec = {}) {
  let t = String(title ?? '')
  let changed = false
  for (const [re, ok] of TITLE_CLAIMS) {
    if (ok(layout) || !re.test(t)) continue
    re.lastIndex = 0
    t = t.replace(re, ' ')
    changed = true
  }
  if (!changed) return title
  t = t.replace(/\s+/g, ' ')
    .replace(/(?:\s*[:&+,/|–—-]\s*|\s+\b(?:and|with|on|using|in|of|for|to|the|a|an)\b\s*)+$/i, '')
    .replace(/^(?:\s*[:&+,/|–—-]\s*|\s*\b(?:and|with|on|using|in|of|for|to)\b\s+)+/i, '')
    .replace(/\s+(?:and|&)\s+(?=(?:and|&)\b)/gi, ' ')
    .trim()
  // The title already names what the layout prints ("Match Fractions"): no noun.
  if (TITLE_CLAIMS.some(([re, ok]) => ok(layout) && new RegExp(re.source, 'i').test(t))) return t
  const have = new Set(t.toLowerCase().split(/\s+/))
  const noun = layoutNoun(layout, spec).split(' ').filter(w => !have.has(w.toLowerCase())).join(' ')
  return [t, noun].filter(Boolean).join(' ').trim()
}

// ── Duplicate pages ──────────────────────────────────────────────────────────
// A live set printed page 12 with exactly page 9's five "shade 2/4 … 6/12" items.
// Each page reduces to a set of normalised item signatures; a page whose items are
// mostly (≥ DUPLICATE_OVERLAP) already on an earlier accepted page is re-asked.
export const DUPLICATE_OVERLAP = 0.6
const sig = (...parts) => parts.map(v => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}/.]+/gu, ' ').trim()).join(' | ')

/** Normalised item signatures of a normalized hybrid page (one per printed item). Pure. */
export function itemSignatures(n) {
  const { layout, spec = {}, questions = [] } = n ?? {}
  const qa = (list) => (list ?? []).map(q => sig(q.question, q.answer))
  switch (layout) {
    case 'shapes':
      // A fraction is the same drill whether drawn as a bar or a circle, shaded or named.
      return new Set((spec.items ?? []).map(it => (it.kind === 'fraction' ? `fraction ${it.shaded}/${it.parts}` : it.kind === 'count' ? `count ${it.icon} ${it.count}` : `polygon ${it.shape} ${it.ask}`)))
    case 'multiple_choice': return new Set((spec.questions ?? []).map(q => sig(q.question, q.options?.[mcAnswerIndex(q)] ?? q.answer)))
    case 'matching': return new Set((spec.pairs ?? []).map(p => sig(p.term, p.match)))
    case 'sorting': return new Set((spec.items ?? []).map(it => sig(it.word, it.category)))
    case 'labeling': return new Set((spec.labels ?? []).map(l => sig(l.word, l.clue)))
    case 'table_fill': return new Set([...(spec.rows ?? []).map(r => sig(...r.map(c => (c && typeof c === 'object' ? c.answer : c)))), ...qa(spec.questions)])
    case 'activity_art': return new Set()
    default: return new Set(qa(questions))
  }
}

/**
 * The earlier page a page mostly repeats: ≥ DUPLICATE_OVERLAP of its items (and at
 * least 2) already on one accepted page. `accepted` = [{ pageNum, sigs }]. Returns
 * { pageNum, shared: string[], total } or null. Pure.
 */
export function duplicateOf(sigs, accepted = []) {
  if (sigs.size < 2) return null
  for (const a of accepted) {
    const shared = [...sigs].filter(x => a.sigs.has(x))
    if (shared.length >= 2 && shared.length / sigs.size >= DUPLICATE_OVERLAP) return { pageNum: a.pageNum, shared, total: sigs.size }
  }
  return null
}

const duplicateIssue = (d) => `repeats page ${d.pageNum}: ${d.shared.length} of ${d.total} items are already on that page (${d.shared.slice(0, 8).map(x => `"${x.slice(0, 40)}"`).join(', ')}) — write different items that practise another part of the topic`

// ── Prompt ───────────────────────────────────────────────────────────────────
// The exact chart shape, used by the prompt and by the "chart missing" retry hint.
const CHART_SHAPE = `"chart": {"type": "pictograph" | "bar" | "table", "title": "…", "icon": "${CHART_ICONS.join('" | "')}" (pictograph only), "categories": [{"label": "Apples", "value": 4}, {"label": "Pears", "value": 2}]} — 2+ categories, whole-number values (pictograph ≤${CHART_LIMITS.pictograph.maxCategories} categories and ≤${CHART_LIMITS.pictograph.maxValue}, bar ≤${CHART_LIMITS.bar.maxCategories} and ≤${CHART_LIMITS.bar.maxValue}, table ≤${CHART_LIMITS.table.maxCategories} rows)`

// The exact call shape: last line of the prompt, and the retry hint for a page whose
// call came back unparseable (bare array, flat page, 400 tool_use_failed).
export const EXPECTED_SHAPE = 'Call generate_layout_content with {"pages":[{"pageNum":<n>,"title":"<short page title>","layout":"<one layout>", ...that layout\'s fields}]} — one entry per page above.'

export function questionRange(packageType) {
  return packageType === 'free' ? [4, 5] : packageType === 'large' ? [5, 8] : [4, 6]
}

/**
 * Hybrid content prompt for a chunk of pages. `feedback` maps pageNum → errors from a
 * failed attempt; `suggested` maps pageNum → the set-wide layout (assignLayouts),
 * else the per-page hint. Pure.
 */
export function buildHybridContentPrompt(plan, pages, feedback = new Map(), suggested = null) {
  const [qMin, qMax] = questionRange(plan.packageType)
  const pageList = pages.map(p => {
    const fb = feedback.get(p.pageNum)
    return `- Page ${p.pageNum} (${p.type}, suggested layout: ${suggested?.get(p.pageNum) ?? suggestLayout(p)}): ${p.imagePrompt}${fb ? `\n  PREVIOUS ATTEMPT WAS REJECTED — fix: ${fb.join('; ')}` : ''}`
  }).join('\n')

  return `You are a curriculum designer writing printable worksheets for Teachers Pay Teachers.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Every page is typeset by code from the structured data you return. Pick ONE layout per page and fill ONLY that layout's fields (leave the others out):
- questions: questions [{num, question, answer}], ${qMin}–${qMax} items. Short-answer knowledge questions or word problems.
- multiple_choice: questions [{num, question, options (2–4), answer}], ${qMin}–${qMax} items — the questions list is never empty, and each item carries its own options. answer = the letter (A–D) of the one correct option; options distinct.
- fill_blank: wordBank (the answers, ≤3 words each) + sentences [{num, sentence, answer}], ${qMin}–${qMax} items. Each sentence contains "___" where its answer goes and never contains the answer itself; every answer is in wordBank.
- matching: pairs [{term, match}], 4–8 pairs. term ≤${LIMITS.term} chars, match ≤12 words (a definition, unique fact or word). Code shuffles the right column.
- sorting: categories (a list of 2–3 heading strings, e.g. ["Living", "Nonliving"]) + sortItems [{word, category}], 6–12 items, each category used at least twice. Each word is 1–3 words (a short simile or idiom such as "as busy as a bee" may be up to ${LIMITS.word} characters), never a whole sentence, and its category is spelled exactly as one of the headings.
- labeling: subject (one concrete thing drawn large, e.g. "a sunflower plant") + labels [{word, clue}], 4–6 labels. The student writes the word from the word bank next to each numbered clue. A clue describes the part's job or look in words and never contains its word.
- table_fill: columns (2–4 headers) + rows (3–6 rows, each the same length as columns). A blank cell is written as its answer in square brackets, e.g. ["Cat", "4", "[8]"]. Every blank must follow from the rest of its row (a rule named in the header such as "Total" or "Double") or from a well-known fact. Optional: up to 3 questions that need the table (compare, total, difference) — never one whose answer is just a blank or a printed cell.
- shapes: shapeItems, 4–8 items drawn by code: {kind:"fraction", shape: circle|rectangle|bar, parts 2–12, shaded, ask: "name" (write the fraction) | "shade" (student shades it)}, {kind:"count", icon: ${CHART_ICONS.join('|')}, count 1–20}, {kind:"polygon", shape, ask: "sides" | "corners" | "name"} — polygon items only on a page about 2D shapes/geometry, never on a fractions or any other page; there, ask "name" only for triangle, pentagon, hexagon, octagon or circle (a square is also a rectangle and a rhombus).
- chart: chart + questions (${qMin}–${qMax}). Picture graph (≤${CHART_LIMITS.pictograph.maxCategories} categories, values ≤${CHART_LIMITS.pictograph.maxValue}), bar graph (≤${CHART_LIMITS.bar.maxCategories} bars, values ≤${CHART_LIMITS.bar.maxValue}) or table (≤${CHART_LIMITS.table.maxCategories} rows); whole numbers; icon for picture graphs. Every question is answered by reading the chart. Never pie/line/double-bar graphs. A chart page ALWAYS has its chart object: ${CHART_SHAPE}.
- activity_art: a colouring page. subject (one simple thing to colour) + instruction (one sentence, e.g. "Colour the picture.") + tasks (0–3 short lines, e.g. "Write the word moon three times."). Use it only when the page description is a colouring or drawing page. Another AI draws the picture and you never see it, so every task must work on ANY picture of the subject: "Colour the biggest thing.", "Write one word about the picture.", "Draw 3 stars around it." Never name a part or detail of the drawing, never give a part its colour ("Colour the cat's collar blue", "Colour the wings of the bee"), never "Draw a hat on the cat", and never count things in the drawing — count only things the task itself states.

Use the suggested layout unless the page description clearly fits another one. Crosswords, word searches, mazes and dot-to-dot are not possible — use matching, fill_blank or labeling on the same content. No layout draws a number line, clock, ruler, map or grid: such a page becomes questions or fill_blank written in words ("A number line from 0 to 1 is split into fourths. What fraction is at the second mark?"). Word problems use questions.
title: what the page really prints, ≤6 words — never promise a number line, word problems, models or pictures it does not have. Every page practises something different: never copy another page's items.

THE PICTURE IS DECORATION ONLY. Each page gets one illustration from an AI that cannot count, spell or place details. So:
- Never refer to the picture/image/illustration/drawing, never ask what is "shown", never ask to count, find, circle or locate something in it, and never ask to colour a specific part or use a specific colour (no "Colour the rings yellow"). Counting is only allowed on shapes items and chart data, which code draws exactly.
- illustrationSubject: a concrete thing from the page topic (≤8 words) to draw, e.g. "a smiling orange pumpkin with a green stem" — never a table, chart, sign, word, number or letter.

Content rules:
- Every question, clue, blank and table cell has exactly ONE correct, checkable answer that is factually and academically correct — a teacher can mark it right or wrong from the answer key alone. No opinion or guessing questions ("What do you think…", "Who is likely…"), no negative questions with several valid answers, no questions about the student's own drawing, collection, choice, favourite, story or experience: never "your …", "did you", "you chose/found/drew", and never start with "Draw", "Describe" or "Write a sentence".
  Bad: "What is your favourite pizza topping?", "Describe how you would share a pizza.", "Draw a pizza cut into fourths." Good: "A pizza is cut into 8 equal slices and 3 are eaten. What fraction is eaten?" (3/8); "Which is bigger, 1/2 or 1/4 of the same pizza?" (1/2).
- Matching: each match must be TRUE for its own term and FALSE for every other term on the page, so a student who knows the topic finds exactly one fit. Use a definition, a fact unique within the list, or a superlative ("closest", "largest", "only") — never a property several of the terms share ("has rings", "is a mammal", "lives in water", "is big", "is important"). In a set whose members are alike (planets, animals, shapes) pick the one fact that singles each out. Terms all different; a match never contains its own term.
  Bad (planets): Saturn – "Has a system of rings" (Jupiter, Uranus and Neptune have rings too). Good: Mercury – "Closest planet to the Sun"; Jupiter – "Largest planet".
- Matching terms are clearly different concepts: no near-synonyms or stages that blur into each other ("sprout" and "seedling"), no parent/part pairs ("plant" and "leaf"), no two things that do the same job ("seed" and "pollen" both "start a new plant"). A match never reuses the key words of another pair's meaning.
  Bad (plants): sprout – "first shoot from a seed", seedling – "young plant with a few leaves" (each fits both). Good: root – "Holds the plant in the soil"; pollen – "Yellow dust bees carry from flower to flower".
- Sorting: every word clearly belongs to exactly one category and appears only once.
- Use only words a ${plan.gradeLevel} student can read; avoid technical terms unless the page defines them.
- Answers are short: a word, number or short phrase.

Pages:
${pageList}

${EXPECTED_SHAPE}`
}

// ── Normalize + repair + validate ────────────────────────────────────────────
const s = (v) => cleanText(v).trim()
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, ' ')
const has = (v) => v !== null && v !== undefined
// Keys of a list written as an object: "1", "q2", "item_3" or a letter "A".
const INDEX_KEY = /^\s*(?:[A-Za-z_ -]{0,12}?(\d+)|([A-Ja-j]))\s*$/
const keyRank = (k) => { const m = k.match(INDEX_KEY); return m[1] !== undefined ? Number(m[1]) : m[2].toUpperCase().charCodeAt(0) - 64 }
/**
 * A list field as an array: arrays as-is; an object keyed by index/num/letter
 * ({"1": {...}, "2": {...}}) as its values sorted by key; a JSON string of either
 * parsed first; anything else []. Pure.
 */
export const toList = (v) => {
  if (Array.isArray(v)) return v
  // gpt-oss sometimes writes a list as a JSON string ("[{\"question\": …}]").
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { return toList(JSON.parse(v)) } catch { return [] } }
  if (!v || typeof v !== 'object') return []
  const keys = Object.keys(v)
  if (!keys.length || !keys.every(k => INDEX_KEY.test(k))) return []
  return keys.sort((a, b) => keyRank(a) - keyRank(b)).map(k => v[k])
}
const arr = (v) => toList(v).filter(has)

// Fields that only a page object carries (used to recognise a flat single page).
const PAGE_KEYS = ['pageNum', 'title', 'layout', 'questions', 'sentences', 'wordBank', 'pairs', 'categories', 'sortItems', 'labels', 'columns', 'rows', 'shapeItems', 'instruction', 'tasks', 'chart', 'subject', 'illustrationSubject']
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const looksLikePage = (v) => isObj(v) && PAGE_KEYS.some(k => has(v[k]))

/**
 * The raw pages of a generate_layout_content answer, whatever its shape: a JSON
 * string, a bare array of pages, {pages: [...]} or {pages: {"1": {...}}} (toList), a
 * {name, arguments} wrapper (Groq failed_generation), or one flat page object.
 * Anything else → []. Pure.
 */
export function coercePages(args) {
  if (typeof args === 'string') {
    if (!/^\s*[[{]/.test(args)) return []
    try { return coercePages(JSON.parse(args)) } catch { return [] }
  }
  if (Array.isArray(args)) return args.flatMap(x => (isObj(x) && has(x.pages) && !looksLikePage({ ...x, pages: undefined }) ? coercePages(x.pages) : isObj(x) ? [x] : []))
  if (!isObj(args)) return []
  if (has(args.pages)) {
    if (isObj(args.pages) && looksLikePage(args.pages)) return [args.pages]
    return toList(args.pages).flatMap(x => (isObj(x) ? [x] : []))
  }
  if (has(args.arguments)) return coercePages(args.arguments)
  if (looksLikePage(args)) return [args]
  return toList(args).filter(isObj)
}

const filled = (v) => toList(v).filter(has).length > 0
const hasText = (v) => typeof v === 'string' && v.trim() !== ''

/**
 * The layout a raw page's fields imply, for a page that names none (or an unknown
 * one); else the plan's keyword hint (suggestLayout). Pure.
 */
export function inferLayout(raw, page = null) {
  const hint = suggestLayout(page)
  if (!isObj(raw)) return hint
  const c = raw.chart
  if (isObj(c) && (filled(c.categories) || hasText(c.type))) return 'chart'
  if (filled(raw.pairs)) return 'matching'
  if (filled(raw.sortItems)) return 'sorting'
  if (filled(raw.labels)) return 'labeling'
  if (filled(raw.sentences)) return 'fill_blank'
  if (filled(raw.rows)) return 'table_fill'
  if (filled(raw.shapeItems)) return 'shapes'
  if (hasText(raw.instruction) || filled(raw.tasks)) return 'activity_art'
  if (filled(raw.categories)) return hint === 'chart' ? 'chart' : 'sorting'
  const qs = arr(raw.questions)
  if (qs.length) {
    if (qs.some(q => isObj(q) && filled(q.options))) return 'multiple_choice'
    // A chart page that came back without its chart stays a chart page, so the
    // validator asks for the chart instead of shipping questions about a missing graph.
    return hint === 'chart' ? 'chart' : 'questions'
  }
  return hint
}

/** A printable title from the plan page ("plant-life-cycle" → "Plant Life Cycle"). Pure. */
export function titleFromPage(page) {
  const words = String(page?.filename ?? '').replace(/\.(png|pdf)$/i, '').replace(/^\d+[-_\s]*/, '').split(/[-_\s]+/).filter(Boolean)
  return words.length ? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : `Page ${page?.pageNum ?? ''}`.trim()
}
const dedupeBy = (list, key) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true }) }
const BLANK_RE = /_{2,}/
// Sort items left after dropping over-long ones (the prompt asks for 6–12).
export const SORT_KEEP_MIN = 6
const sortItemFits = (categories) => (it) => !!it.word && it.word.length <= LIMITS.word && categories.includes(it.category)

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
  /\b(?:the|this|that) (?:story|passage|poem|text|list|data|graph|chart|map|diagram|page)\b/i,
  // "the table" alone is often furniture ("4 apples on the table"); only data-table wording counts.
  /\b(?:in|from|using|use|read|look at|according to) (?:the|this|that) table\b|\b(?:the|this|that) table (?:shows?|above|below|lists?)\b/i,
  /\b(?:sentence|section|row|item|card|example|box|step|column) (?:\d+|[A-H])\b/,
  /\b(?:first|second|third|fourth|fifth|last) (?:picture|image|word|row|column|box)\b/i,
]
/** True if a question reads something a questions page does not print. Pure — exported for unit testing. */
export const readsOtherPageContent = (q) => READS_MISSING.some(re => re.test(String(q ?? '')))

/** True if student-facing text depends on the decorative picture. Pure — exported for unit testing. */
export function isPictureDependent(text) {
  return PICTURE_DEPENDENT.some(re => re.test(String(text ?? '')))
}

// ── Matching / sorting ambiguity (cheap code checks) ─────────────────────────
// "One verifiable answer per question": a matching meaning true for several terms
// lets a student be right and marked wrong. These checks are deterministic and
// conservative; the Groq self-check below catches the rest (shared properties).
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Lower-case, punctuation and filler words (a/an/the/it/is/are) removed, for near-duplicate checks. Pure. */
const loose = (v) => norm(v).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\b(?:a|an|the|it|its|is|are)\b/g, ' ').replace(/\s+/g, ' ').trim()
// Bare vague properties: never a definition, so never unique within a list.
const VAGUE_MATCH = /^(?:(?:it|they) )?(?:is|are) (?:very |really |so )?(?:big|large|small|tiny|huge|important|useful|helpful|interesting|special|nice|good|cool|common|different)$/
// "Has rings" alone: true of every giant planet, the live failure this guards.
const RINGS_MATCH = /^(?:(?:it|they) )?(?:has|have) (?:a )?(?:(?:system|set) of )?rings?(?: system)?(?: around (?:it|them))?$/

// ── Numeric values (fractions, numerals, number words) ───────────────────────
// A matching page about numbers ("1/3" ↔ "one third") is unambiguous when every value
// is distinct, but the self-check flagged a third of such pages ("one third" is also
// true of "1/2"). numericValue reads a text that is nothing but a number, so code can
// overrule a claim between two different values and flag two equal ones ("1/2" and
// "2/4") instead.
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const ORDINALS = { half: 2, halves: 2, third: 3, quarter: 4, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, hundredth: 100 }
const VULGAR = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 }
const cardinal = (w) => {
  if (/^\d+$/.test(w)) return Number(w)
  const i = UNITS.indexOf(w)
  if (i >= 0) return i
  const [tens, unit, extra] = w.split('-')
  if (TENS[tens] === undefined || extra !== undefined) return null
  if (unit === undefined) return TENS[tens]
  const u = UNITS.indexOf(unit)
  return u >= 1 && u <= 9 ? TENS[tens] + u : null
}
const denominator = (w) => {
  if (ORDINALS[w]) return ORDINALS[w]
  const sing = w.replace(/s$/, '')
  if (ORDINALS[sing]) return ORDINALS[sing]
  const m = w.match(/^(\d+)(?:st|nd|rd|th)s?$/)
  return m ? Number(m[1]) : null
}
/** A fraction / proper value with its numerator over its denominator (null if not a number). */
const ratio = (num, den) => (num === null || !den ? null : num / den)
/**
 * The value of a text that is only a number: "3", "2.5", "50%", "1/3", "1 1/2", "½",
 * "one third", "two-thirds", "a half", "twenty-one", "3 out of 4 (equal parts)";
 * null for anything else ("1/3 of a pizza", "less than one half"). Pure.
 */
export function numericValue(text) {
  let t = s(text).toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (VULGAR[t] !== undefined) return VULGAR[t]
  let m
  if ((m = t.match(/^(\d+) ?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/))) return Number(m[1]) + VULGAR[m[2]]
  if ((m = t.match(/^-?\d+(?:\.\d+)?$/))) return Number(t)
  if ((m = t.match(/^(\d+(?:\.\d+)?) ?(?:%|percent)$/))) return Number(m[1]) / 100
  if ((m = t.match(/^(?:(\d+) )?(\d+) ?\/ ?(\d+)$/))) return (m[1] ? Number(m[1]) : 0) + ratio(Number(m[2]), Number(m[3]))
  if ((m = t.match(/^(\S+) out of (\S+)(?: equal)?(?: parts?| pieces?| slices?| sections?)?(?: (?:are )?(?:shaded|colou?red))?$/))) return ratio(cardinal(m[1]), cardinal(m[2]))
  t = t.replace(/^(\S+)-(halves|half|thirds?|quarters?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|twelfths?)$/, '$1 $2')
  if ((m = t.match(/^(\S+) (\S+)$/))) return ratio(m[1] === 'a' || m[1] === 'an' ? 1 : cardinal(m[1]), denominator(m[2]))
  if (t === 'half') return 0.5
  return cardinal(t)
}
const sameValue = (a, b) => Math.abs(a - b) < 1e-9

/**
 * Ambiguity issues of a matching spec ([] = none found): meanings that are the same
 * after normalisation, a meaning that contains its own term, and bare shared
 * properties ("Has rings", "Is big"). Messages are written for the retry prompt. Pure.
 */
export function matchingIssues(pairs = []) {
  const issues = []
  const seen = new Map()
  pairs.forEach((p, i) => {
    const m = loose(p.match)
    const t = loose(p.term)
    const prev = seen.get(m)
    if (m && prev !== undefined && norm(pairs[prev].match) !== norm(p.match)) issues.push(`"${p.term}" and "${pairs[prev].term}" have the same match ("${p.match}") — give each term a different fact`)
    else if (m) seen.set(m, i)
    if (t.length >= 2 && new RegExp(`(?:^| )${esc(t)}(?:s|es)?(?: |$)`).test(m)) issues.push(`the match for "${p.term}" contains the term itself — it gives the answer away`)
    const bare = norm(p.match).replace(/[.!]+$/, '')
    if (VAGUE_MATCH.test(bare) || RINGS_MATCH.test(bare)) issues.push(`"${p.match}" (for "${p.term}") is a property several items share — use a fact true only for "${p.term}"`)
  })
  // Two numeric matches (or terms) with the same value, written differently ("1/2" and
  // "two fourths"): a student can pair either one. Identical texts are caught above.
  for (const side of ['match', 'term']) {
    const vals = pairs.map(p => numericValue(p[side]))
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        if (vals[i] === null || vals[j] === null || !sameValue(vals[i], vals[j]) || loose(pairs[i][side]) === loose(pairs[j][side])) continue
        issues.push(`"${pairs[i][side]}" and "${pairs[j][side]}" are the same number — every ${side} must be a different value`)
      }
    }
  }
  return issues
}

/** Ambiguity issues of a sorting spec: a word under two categories, or a word that is a heading. Pure. */
export function sortingIssues(spec = {}) {
  const issues = []
  const cats = new Map()
  for (const it of spec.items ?? []) {
    const k = norm(it.word)
    const e = cats.get(k) ?? { word: it.word, list: [] }
    e.list.push(it.category)
    cats.set(k, e)
    if ((spec.categories ?? []).some(c => norm(c) === k)) issues.push(`sort word "${it.word}" is also a category heading`)
  }
  for (const { word, list } of cats.values()) {
    if (new Set(list.map(norm)).size > 1) issues.push(`sort word "${word}" is listed under ${list.map(c => `"${c}"`).join(' and ')} — each word must fit exactly one category`)
  }
  return issues
}

const sortExample = (it) => `{"word": "${it.word}", "category": "${it.category}"}`
/**
 * Retry hint for a sorting page whose items do not fit: the exact category list,
 * the word limit, and two good / two bad items from the page itself ('' = all fit). Pure.
 */
export function sortingHint(spec = {}) {
  const cats = spec.categories ?? []
  const items = spec.items ?? []
  const fits = sortItemFits(cats)
  const bad = items.filter(it => !fits(it))
  if (cats.length && !bad.length) return ''
  if (!cats.length) return 'sorting: "categories" was empty — return 2–3 column headings as a list of strings (e.g. ["Living", "Nonliving"]) and give every sort item one of them, spelled exactly'
  const why = (it) => (!it.word ? 'empty word' : it.word.length > LIMITS.word ? `a sentence, not 1–3 words (≤${LIMITS.word} chars)` : 'category not in the list')
  const good = items.filter(fits).slice(0, 2)
  return `sort items: every category must be exactly one of ${cats.map(c => `"${c}"`).join(', ')} (spelled exactly) and each word 1–3 words (a short simile or idiom may be up to ${LIMITS.word} characters), never a sentence. ${good.length ? `Good: ${good.map(sortExample).join(', ')}. ` : ''}Bad: ${bad.slice(0, 2).map(it => `${sortExample(it)} (${why(it)})`).join(', ')}`
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

// ── activity_art: tasks that need a specific drawn detail ────────────────────
// The FLUX picture is generic, so "Colour the cat's collar blue" may have no collar
// to colour. Only activity_art tasks/instruction are checked with these (stricter
// than isPictureDependent); each pattern needs a named part, a part's colour, an
// object drawn ON the picture, or a count with no number stated in the task.
const COLOURS = 'red|orange|yellow|green|blue|purple|violet|pink|brown|black|grey|gray|gold|silver|white'
const NOT_A_PART = '(?!(?:picture|page|drawing|image|illustration|whole|rest|background|border|frame)\\b)'
const ACTIVITY_DETAIL = [
  // "Colour the cat's collar", "Circle the bee's wings"
  /\b(?:colou?r|paint|shade|circle|trace|outline|decorate|draw)\b[^.?!]*\b\p{L}+['’]s \p{L}+/iu,
  // "Colour the wings of the bee", "Colour the spots on the ladybug"
  new RegExp(`\\b(?:colou?r|paint|shade|circle|trace|outline)\\b (?:the|its|each|every|all(?: the)?) ${NOT_A_PART}\\p{L}+ (?:of|on|in) (?:the|its|his|her|their)\\b`, 'iu'),
  // "Draw a hat on the cat"
  /\bdraw (?:a|an|some|one|two|three|four|five|\d+|more) [^.?!]{1,30}? on (?:the|its|his|her|their)\b/i,
  // "Use blue for the sky"
  new RegExp(`\\buse (?:${COLOURS}) (?:for|on|to colou?r) (?:the|its)\\b`, 'i'),
]
const COUNTS = /\b(?:count|how many)\b/i
const STATED_NUMBER = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/i
/** True if an activity_art task/instruction needs a specific detail of the drawn picture. Pure — exported for unit testing. */
export function isPictureDetailTask(text) {
  const t = String(text ?? '')
  return ACTIVITY_DETAIL.some(re => re.test(t)) || (COUNTS.test(t) && !STATED_NUMBER.test(t))
}
const artTextDependent = (t) => isPictureDependent(t) || isPictureDetailTask(t)
const DEFAULT_ART_INSTRUCTION = 'Colour the picture.'
const ART_HINT = 'activity_art tasks must work on ANY picture of the subject (another AI draws it and you never see it), e.g. "Colour the biggest thing.", "Write one word about the picture.", "Draw 3 stars around it." — never name a part or detail, never give a part a colour, never count things in the drawing'

/**
 * An activity_art attempt with its picture-dependent tasks dropped and a
 * picture-dependent instruction replaced by "Colour the picture." (tasks are
 * optional, so this never changes what the page is). Null if nothing changes. Pure.
 */
export function repairActivityArt(n) {
  if (n?.layout !== 'activity_art') return null
  const tasks = (n.spec.tasks ?? []).filter(t => !artTextDependent(t))
  const instrBad = artTextDependent(n.spec.instruction)
  const dropped = (n.spec.tasks?.length ?? 0) - tasks.length
  if (!dropped && !instrBad) return null
  const { tasks: _t, ...rest } = n.spec
  const spec = { ...rest, instruction: instrBad ? DEFAULT_ART_INSTRUCTION : n.spec.instruction, ...(tasks.length ? { tasks } : {}) }
  const what = [dropped ? `dropped ${dropped} task(s)` : '', instrBad ? 'replaced the instruction' : ''].filter(Boolean).join(' and ')
  return { ...n, spec, repairs: [...(n.repairs ?? []), `activity_art: ${what} that needed a detail of the picture`] }
}

// ── chart: find the chart object wherever the model put it ───────────────────
const CHART_TYPE_ALIASES = [
  [/^(?:pictograph|picto ?gram|picture ?(?:graph|chart))$/, 'pictograph'],
  [/^bar(?: ?(?:graph|chart))?$/, 'bar'],
  [/^(?:(?:data|frequency) )?table$|^tally(?: chart| table)?$/, 'table'],
]
const chartTypeOf = (v) => {
  const t = norm(v).replace(/[_-]+/g, ' ')
  return CHART_TYPE_ALIASES.find(([re]) => re.test(t))?.[1] ?? (t || undefined)
}
const chartValue = (v) => {
  if (typeof v === 'number') return v
  const m = String(v ?? '').match(/^\s*(\d+(?:\.\d+)?)\b/)
  return m ? Number(m[1]) : NaN
}
const parseJsonObject = (v) => {
  if (typeof v !== 'string' || !/^\s*\{/.test(v)) return v
  try { return JSON.parse(v) } catch { return null }
}
/** Chart categories in any shape the model writes → [{ label, value }] ([] if none). */
function chartCategories(c) {
  let cats = c?.categories ?? c?.data ?? c?.values
  if (typeof cats === 'string' && /^\s*[[{]/.test(cats)) { try { cats = JSON.parse(cats) } catch { cats = [] } }
  // { "Apples": 4, "Pears": 2 }
  if (cats && typeof cats === 'object' && !Array.isArray(cats) && !toList(cats).length) {
    return Object.entries(cats).map(([label, value]) => ({ label: s(label), value: chartValue(value) }))
  }
  // labels: [...] + values: [...] side by side
  if (!arr(cats).length && Array.isArray(c?.labels) && Array.isArray(c?.values)) {
    return c.labels.map((label, i) => ({ label: s(label), value: chartValue(c.values[i]) }))
  }
  return arr(cats).map(x => {
    // "Mercury: 3" strings → { label, value }
    if (typeof x === 'string') {
      const m = x.match(/^(.*?)[\s:=–-]+(\d+)\s*$/)
      return m ? { label: s(m[1]), value: Number(m[2]) } : { label: s(x), value: NaN }
    }
    if (!x || typeof x !== 'object') return { label: '', value: NaN }
    return { label: s(x.label ?? x.name ?? x.category ?? x.item), value: chartValue(x.value ?? x.count ?? x.amount ?? x.number) }
  })
}
const looksLikeChartData = (cats) => cats.length >= 2 && cats.every(c => c.label && Number.isFinite(c.value))

/**
 * The chart of a chart page from its raw content: `chart` as an object or a JSON
 * string, with type aliases ("picture graph", "bar chart"), categories as a list,
 * "Label: 4" strings, a { label: value } map or labels + values arrays, and string
 * values ("4"). If `chart` is absent/null, chart fields the model wrote on the page
 * itself (chartType, categories with values, data) are lifted. A missing type is
 * inferred (pictograph when it fits and has an icon, else bar; repairChart turns an
 * over-limit bar into a table). Returns { chart, lifted? } or null. Pure.
 */
export function normalizeChart(raw) {
  let c = parseJsonObject(raw?.chart)
  let lifted = null
  if (!c || typeof c !== 'object' || Array.isArray(c) || !chartCategories(c).length) {
    const page = { ...raw, type: raw?.chartType ?? raw?.graphType ?? c?.type, categories: raw?.chartData ?? raw?.data ?? raw?.categories ?? c?.categories }
    if (looksLikeChartData(chartCategories(page))) {
      c = { type: page.type, title: raw?.chartTitle ?? c?.title, icon: raw?.icon ?? c?.icon, categories: page.categories }
      lifted = 'chart data written outside the chart object was moved into it'
    } else if (!c || typeof c !== 'object' || Array.isArray(c) || !Object.keys(c).length) return null
  }
  const categories = chartCategories(c)
  let type = chartTypeOf(c.type ?? c.chartType ?? c.kind)
  if (!type) {
    const p = CHART_LIMITS.pictograph
    type = CHART_ICONS.includes(c.icon) && categories.length <= p.maxCategories && categories.every(x => x.value <= p.maxValue) ? 'pictograph' : 'bar'
    lifted = [lifted, `chart type missing — drawn as a ${type}`].filter(Boolean).join('; ')
  }
  const chart = Object.fromEntries(Object.entries({
    type,
    title: s(c.title) || s(raw?.title),
    icon: c.icon,
    unit: c.unit,
    labelHeader: c.labelHeader,
    valueHeader: c.valueHeader,
    categories,
  }).filter(([, v]) => has(v) && v !== ''))
  return lifted ? { chart, lifted } : { chart }
}

// ── sorting: categories and items in any shape, near-matching names ──────────
const catLabel = (c) => (c && typeof c === 'object' && !Array.isArray(c) ? (c.name ?? c.label ?? c.category ?? c.heading ?? c.title) : c)
// A plain "Living, Nonliving" string is a list too (toList only reads JSON).
const stringList = (v) => (typeof v === 'string' && !/^\s*[[{]/.test(v) ? v.split(/\s*(?:[,;|\n]|\s\/\s)\s*/) : arr(v))
const catWords = (v) => norm(v).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/^(?:the|a|an) /, '').split(/\s+/).filter(Boolean)
const wordForms = (w) => new Set([w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')].filter(Boolean))
/** True if two category names are the same heading up to case, spacing, punctuation and plural ("Similes" ≈ "simile"). Pure. */
export function sameCategory(a, b) {
  const x = catWords(a)
  const y = catWords(b)
  if (!x.length || x.length !== y.length) return false
  return x.every((w, i) => { const f = wordForms(w); return [...wordForms(y[i])].some(v => f.has(v)) })
}
/** The listed category a model-written one means: exact (case-insensitive) first, else the one near match. */
const resolveCategory = (categories, c) => categories.find(x => norm(x) === norm(c)) ?? (() => { const near = categories.filter(x => sameCategory(x, c)); return near.length === 1 ? near[0] : undefined })()
/** Raw sort items in any shape: [{word, category}], {"Simile": [...]}, [{category, words: [...]}]. */
function rawSortItems(raw) {
  const src = raw.sortItems ?? raw.items
  if (src && typeof src === 'object' && !Array.isArray(src) && !toList(src).length) {
    return Object.entries(src).flatMap(([category, words]) => stringList(words).map(word => ({ word, category })))
  }
  return arr(src).flatMap(it => {
    if (typeof it === 'string') return [{ word: it, category: '' }]
    const words = it.words ?? it.items
    if (Array.isArray(words)) return words.map(word => ({ word, category: it.category ?? it.name ?? it.heading }))
    return [it]
  })
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
  if (layout && raw?.layoutInferred) repairs.push(`layout missing or unknown in the answer — inferred ${layout} from its fields`)
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
      if (layout === 'chart') {
        const found = normalizeChart(raw)
        if (found) {
          if (found.lifted) repairs.push(found.lifted)
          const { chart, changed } = repairChart(found.chart)
          if (changed && chart) repairs.push('chart outside the bar/picture-graph limits was drawn as a table')
          spec = { chart: chart ?? found.chart }
        }
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
      let categories = dedupeBy(stringList(raw.categories).map(c => s(catLabel(c))).filter(Boolean), norm)
      const rawItems = rawSortItems(raw)
      // No heading list: use the categories the items name, when they form a valid set
      // (2–max distinct headings, each used at least twice).
      if (!categories.length) {
        const groups = []
        for (const it of rawItems) {
          const c = s(catLabel(it?.category))
          if (!c) continue
          const g = groups.find(x => sameCategory(x.name, c) || norm(x.name) === norm(c))
          if (g) g.n++
          else groups.push({ name: c, n: 1 })
        }
        if (groups.length >= LIMITS.categories.min && groups.length <= LIMITS.categories.max && groups.every(g => g.n >= 2)) {
          categories = groups.map(g => g.name)
          repairs.push(`categories list was empty — used the items' categories (${categories.join(', ')})`)
        }
      }
      let renamed = 0
      let items = dedupeBy(rawItems.map(it => {
        const given = s(catLabel(it?.category))
        const cat = resolveCategory(categories, given)
        if (cat && norm(cat) !== norm(given)) renamed++
        return { word: s(it?.word), category: cat ?? given }
      // Keyed by word + category: a word filed under two categories survives so the
      // validator can reject it (ambiguous) instead of silently keeping the first.
      }), it => (norm(it.word) ? `${norm(it.word)}|${norm(it.category)}` : ''))
      if (renamed) repairs.push(`${renamed} sort item category name(s) matched to the listed heading (case/plural/spacing)`)
      // An item that is empty, over LIMITS.word (a whole sentence) or filed under a
      // category not in the list is dropped — never truncated or re-filed, which would
      // change its meaning — when SORT_KEEP_MIN items remain; else the page is re-asked.
      const fits = items.filter(sortItemFits(categories))
      if (fits.length < items.length && fits.length >= SORT_KEEP_MIN) {
        repairs.push(`dropped ${items.length - fits.length} sort item(s) that were empty, longer than ${LIMITS.word} chars or not under a listed category`)
        items = fits
      }
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
  const [qMin, qMax] = questionRange(packageType)
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
      // First, so the retry hint survives the 6-issue feedback cap.
      if (!spec.chart) issues.unshift(`chart missing — return ${CHART_SHAPE}`)
      else {
        const ci = validateChart(spec.chart)
        if (ci.length) issues.unshift(...ci, `chart must be ${CHART_SHAPE}`)
      }
    }
  } else {
    issues.push(...validateLayoutSpec(layout, spec))
    if (layout === 'matching') issues.push(...matchingIssues(spec.pairs))
    if (layout === 'sorting') {
      issues.push(...sortingIssues(spec))
      const hint = sortingHint(spec)
      // First, so the hint survives the 6-issue feedback cap (specs.js lists every item).
      if (hint) issues.unshift(hint)
    }
    if (layout === 'shapes' && Array.isArray(spec.items)) {
      if (spec.items.length < SHAPES_MIN_ITEMS) issues.push(`only ${spec.items.length} shapes items (min ${SHAPES_MIN_ITEMS})`)
      if (plan && page && spec.items.some(it => it.kind === 'polygon') && !polygonsFitTopic(plan, page)) {
        issues.unshift('polygon items (name the shape / sides / corners) are off-topic on this page — use fraction or count items that practise the page topic, or another layout')
      }
    }
    if (layout === 'multiple_choice' && !spec.questions?.length) issues.push(`the questions list was empty — return ${qMin}–${qMax} multiple-choice questions in "questions", each with its own options (2–4) and the answer letter`)
    else if (layout === 'multiple_choice' && spec.questions.length < minQ) issues.push(`only ${spec.questions.length} questions (min ${minQ})`)
  }
  const asked = layout === 'multiple_choice' ? spec.questions : layout === 'table_fill' ? spec.questions : questions
  for (const q of asked ?? []) if (isOpenEndedQuestion(q.question)) issues.push(`q${q.num} is open-ended (no single answer)`)
  // A questions / multiple-choice page prints only its questions, so none may read a
  // story, list, row or icon that is not on the page.
  if (layout === 'questions' || layout === 'multiple_choice') {
    for (const q of asked ?? []) if (readsOtherPageContent(q.question)) issues.push(`q${q.num} refers to something not printed on the page (a story, list, row or icon): "${q.question.slice(0, 80)}"`)
  }
  if (layout !== 'chart' && layout !== 'shapes') {
    const dependent = layout === 'activity_art' ? artTextDependent : isPictureDependent
    const pic = studentTexts(layout, spec, asked).filter(([, t]) => dependent(t)).map(([label, t]) => `${label} depends on the picture: "${t.slice(0, 80)}"`)
    if (pic.length && layout === 'activity_art') issues.unshift(ART_HINT, ...pic)
    else issues.push(...pic)
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
  // The printed subtitle: never a claim the layout does not deliver (fitPageTitle).
  const title = fitPageTitle(s(raw.title), n.layout, n.spec)
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

// ── Matching self-check ──────────────────────────────────────────────────────
// The strongest ambiguity guard: after a matching page validates, a second small
// Groq call sees the terms and the statements (meanings) in the printed, shuffled
// order — never the key — and reports, per statement, the term it best describes and
// every OTHER term it is also true of. A statement true of another term, or matched
// to a different term than the key, is ambiguous → the page is re-asked with those
// pairs named (counts toward HYBRID_MAX_ATTEMPTS). Fail-open: a failed or unusable
// self-check keeps the page with a review note.
// Framing matters: asked "list every meaning that fits each term", gpt-oss solved the
// page as a one-to-one puzzle by elimination and missed "has rings" (live, low and
// medium effort), so the prompt asks it to find flaws, statement by statement.
// ~330 prompt tokens + ≤MATCHING_CHECK_MAX_TOKENS reserved (~1k used at medium effort).
export const MATCHING_CHECK_MAX_TOKENS = 1500
export const MATCHING_CHECK_EFFORT = 'medium'

/** False when MATCHING_SELF_CHECK=off (or 0/false/no). Pure given env. */
export const matchingSelfCheckEnabled = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env.MATCHING_SELF_CHECK ?? '').trim().toLowerCase())

const termNum = { anyOf: [{ type: 'integer' }, { type: 'string' }] }
export const matchingSolveTool = {
  type: 'function',
  function: {
    name: 'report_flaws',
    description: 'For each statement: the term it best describes and every other term it is also true of',
    parameters: {
      type: 'object',
      properties: {
        statements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              letter: { type: 'string' },
              best: { ...termNum, description: 'number of the term the statement best describes' },
              alsoTrueFor: { type: 'array', items: termNum, description: 'numbers of OTHER terms the statement is also factually true of; [] if none' },
            },
            required: ['letter', 'best', 'alsoTrueFor'],
          },
        },
      },
      required: ['statements'],
    },
  },
}

/** Self-check prompt: terms numbered, statements lettered in the order the page prints them. Pure. */
export function buildMatchingCheckPrompt(plan, spec) {
  const order = matchingOrder(spec)
  return `Find flaws in a ${plan.gradeLevel} ${plan.subject} matching worksheet ("${plan.setTitle}"). Each statement must be true of exactly one term, or a student can be right and marked wrong. For each statement give the term it best describes, then — checking every other term on its own real-world facts, not by elimination — list every other term it is ALSO true of.

Terms:
${spec.pairs.map((p, i) => `${i + 1}. ${p.term}`).join('\n')}

Statements:
${order.map((pi, k) => `${LETTERS[k]}. ${spec.pairs[pi].match}`).join('\n')}

Call report_flaws.`
}

/**
 * Compare the self-check's answer with the key. Returns { valid: false } if it does
 * not cover every statement, else { valid, ambiguous, issues, offending } where
 * offending are the pair indices whose statement is also true of another term or
 * was matched to a different term. Pure — exported for unit testing.
 */
export function matchingAmbiguity(spec, args) {
  const order = matchingOrder(spec)
  const n = spec.pairs.length
  const toTerm = (v) => {
    const num = Number(String(v ?? '').match(/^\s*(\d+)/)?.[1])
    return num >= 1 && num <= n ? num - 1 : spec.pairs.findIndex(p => norm(p.term) === norm(v))
  }
  const seen = new Map() // pair index → { best, also }
  for (const st of arr(args?.statements)) {
    const k = LETTERS.indexOf(String(st?.letter ?? '').match(/^\s*\(?([A-Ja-j])\b/)?.[1]?.toUpperCase())
    if (k < 0 || k >= n) continue
    const list = Array.isArray(st.alsoTrueFor) ? st.alsoTrueFor : typeof st.alsoTrueFor === 'string' ? st.alsoTrueFor.split(/[,;\s]+/) : []
    seen.set(order[k], { best: toTerm(st.best), also: [...new Set(list.map(toTerm))].filter(t => t >= 0) })
  }
  if (seen.size < n) return { valid: false }
  const issues = []
  const offending = []
  const conflicts = [] // [j, t]: statement j is also true of term t
  const q = (v) => `"${s(v)}"`
  // A purely numeric statement is true only of a term with the same value: a claim
  // that "one third" also fits "1/2" is the checker's mistake, not an ambiguity.
  const differentNumber = (j, t) => {
    const a = numericValue(spec.pairs[j].match)
    const b = numericValue(spec.pairs[t].term)
    return a !== null && b !== null && !sameValue(a, b)
  }
  for (let j = 0; j < n; j++) {
    const { best, also } = seen.get(j)
    const others = [...new Set([best, ...also])].filter(t => t >= 0 && t !== j && !differentNumber(j, t))
    if (!others.length) continue
    offending.push(j)
    for (const t of others) conflicts.push([j, t])
    const { term, match } = spec.pairs[j]
    issues.push(best >= 0 && best !== j && !differentNumber(j, best)
      ? `ambiguous: a checker matched ${q(match)} to ${q(spec.pairs[best].term)}, not ${q(term)} — use a fact true only for ${q(term)}`
      : `ambiguous: the match ${q(match)} (for ${q(term)}) is also true for ${others.map(t => q(spec.pairs[t].term)).join(', ')} — use a fact true only for ${q(term)}`)
  }
  return { valid: true, ambiguous: issues.length > 0, issues, offending, conflicts }
}

/** One Groq self-check call. Returns the tool args (or null). Throws on API errors. */
async function solveMatchingGroq(plan, spec, stats) {
  const t0 = Date.now()
  try {
    const res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: MATCHING_CHECK_MAX_TOKENS,
      tool: matchingSolveTool,
      messages: [{ role: 'user', content: buildMatchingCheckPrompt(plan, spec) }],
      label: 'Groq matching self-check',
      step: 'content_self_check',
      extra: { reasoning_effort: MATCHING_CHECK_EFFORT },
    })
    stats?.calls.push({ kind: 'matching_check', pages: 1, ms: Date.now() - t0, usage: res.usage ?? null, ok: !!res.args })
    return res.args
  } catch (err) {
    stats?.calls.push({ kind: 'matching_check', pages: 1, ms: Date.now() - t0, error: err.status ?? err.message, code: err.error?.code ?? err.code })
    throw err
  }
}

/**
 * Self-check one matching spec. Returns matchingAmbiguity's result, or { error } when
 * the call failed or its answer was unusable (callers keep the page: fail-open).
 */
export async function selfCheckMatching(plan, spec, { solve = solveMatchingGroq, stats = null } = {}) {
  try {
    const r = matchingAmbiguity(spec, await solve(plan, spec, stats))
    return r.valid ? r : { error: 'answer did not cover every term' }
  } catch (err) {
    return { error: String(err.status ?? err.message) }
  }
}

/** A matching spec without the offending pairs, if ≥ `min` remain; else null. Pure. */
export function dropPairs(spec, offending, min = LIMITS.pairs.min) {
  const pairs = spec.pairs.filter((_, i) => !offending.includes(i))
  return pairs.length >= min ? { ...spec, pairs } : null
}

// A self-check ambiguity between two near-synonyms ("sprout" / "seedling") is fixed on
// the spot by dropping as few pairs as possible, when at least this many remain; fewer
// → the page is re-asked. Code-found ambiguity (has rings, same match) is never dropped.
export const MATCHING_DROP_MIN_PAIRS = 4

/**
 * The fewest pair indices to drop so no conflict [j, t] (statement j also true of term
 * t) is left: greedily the pair in most remaining conflicts; ties → the pair whose own statement
 * is ambiguous, then the later pair. Pure.
 */
export function pairsToDrop(conflicts = []) {
  let left = conflicts.filter(([j, t]) => j !== t)
  const drop = []
  while (left.length) {
    const deg = new Map() // pair → [conflicts it is in, conflicts it owns the statement of]
    const bump = (i, own) => { const d = deg.get(i) ?? [0, 0]; d[0]++; d[1] += own; deg.set(i, d) }
    for (const [j, t] of left) { bump(j, 1); bump(t, 0) }
    const pick = [...deg].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || b[0] - a[0])[0][0]
    drop.push(pick)
    left = left.filter(([j, t]) => j !== pick && t !== pick)
  }
  return drop.sort((a, b) => a - b)
}

// ── Matching replacement pairs ───────────────────────────────────────────────
// When the self-check's flagged pairs leave fewer than MATCHING_DROP_MIN_PAIRS, one
// small Groq call asks for only the missing pairs, with every kept and dropped term
// listed as off-limits (and their near-synonyms), instead of re-asking the whole page.
// The merged page must pass the code checks (has rings, same match, …) and, when the
// self-check is on, a second self-check; otherwise the page goes to the next attempt.
export const MATCHING_REPLACE_MAX_TOKENS = 1500
export const matchingReplaceTool = {
  type: 'function',
  function: {
    name: 'replacement_pairs',
    description: 'New matching pairs whose terms are clearly different from every listed term',
    parameters: {
      type: 'object',
      properties: {
        pairs: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, match: { type: 'string' } }, required: ['term', 'match'] } },
      },
      required: ['pairs'],
    },
  },
}

/** Prompt for `need` replacement pairs; kept pairs are shown, kept + dropped terms are off-limits. Pure. */
export function buildMatchingReplacePrompt(plan, page, { kept, dropped, need }) {
  return `A ${plan.gradeLevel} ${plan.subject} matching worksheet ("${plan.setTitle}", page: ${page.imagePrompt ?? page.title ?? ''}) needs ${need} more pair(s) of {term, match}.

Pairs already on the page (keep them; do not repeat them):
${kept.map(p => `- ${p.term} – ${p.match}`).join('\n')}

Do NOT use these terms, or any near-synonym, stage, part or whole of them, or anything that does the same job: ${[...kept, ...dropped].map(p => `"${p.term}"`).join(', ')}.

Each new match must be TRUE for its own term and FALSE for every other term on the page (the kept ones too): a definition or a fact unique to it, never a property several terms share, never reusing another pair's key words, never containing its own term. Term ≤${LIMITS.term} chars, match ≤12 words, words a ${plan.gradeLevel} student can read.

Call replacement_pairs with exactly ${need} pair(s).`
}

/** One Groq call for replacement pairs. Returns [{ term, match }] (maybe empty). Throws on API errors. */
async function fetchReplacementPairsGroq(plan, page, ctx, stats) {
  const t0 = Date.now()
  try {
    const res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: MATCHING_REPLACE_MAX_TOKENS,
      tool: matchingReplaceTool,
      messages: [{ role: 'user', content: buildMatchingReplacePrompt(plan, page, ctx) }],
      label: 'Groq matching replacement',
      step: 'content',
    })
    stats?.calls.push({ kind: 'matching_replace', pages: 1, ms: Date.now() - t0, usage: res.usage ?? null, ok: !!res.args })
    return arr(res.args?.pairs)
  } catch (err) {
    stats?.calls.push({ kind: 'matching_replace', pages: 1, ms: Date.now() - t0, error: err.status ?? err.message, code: err.error?.code ?? err.code })
    throw err
  }
}

/**
 * Kept pairs + `need` replacement pairs as a validated normalized page, or null (call
 * failed, too few usable pairs, code checks fail, or the self-check flags it again).
 */
async function replacePairs({ plan, c, kept, dropped, valid, fetchReplacements, selfCheck, solveMatching, stats }) {
  const need = MATCHING_DROP_MIN_PAIRS - kept.length
  let raw
  try {
    raw = await fetchReplacements(plan, c.page, { kept, dropped, need }, stats)
  } catch (err) {
    console.warn(`matching replacement p${c.page.pageNum} failed (${err.status ?? err.message}) — page re-asked`)
    return null
  }
  const taken = new Set([...kept, ...dropped].map(p => norm(p.term)))
  const fresh = dedupeBy(arr(raw).map(p => ({ term: s(p?.term), match: s(p?.match) })).filter(p => p.term && p.match && !taken.has(norm(p.term))), p => norm(p.term)).slice(0, need)
  if (fresh.length < need) return null
  const n = valid({ ...c.n.spec, pairs: [...kept, ...fresh] }, `replaced ${dropped.length} ambiguous matching pair(s)`)
  if (!n || !selfCheck) return n
  const r = await selfCheckMatching(plan, n.spec, { ...(solveMatching ? { solve: solveMatching } : {}), stats })
  if (r.error) return n // fail-open, like the first self-check
  return r.ambiguous ? null : n
}

// ── Groq calls ───────────────────────────────────────────────────────────────
/**
 * The raw pages inside a Groq 400 tool_use_failed `failed_generation` — usually
 * `{"name": "generate_layout_content", "arguments": [ ...pages ]}` (a bare array, which
 * the schema rejects). Falls back to the text after `"arguments":` when the wrapper
 * itself does not parse. [] when nothing usable. Pure.
 */
export function pagesFromFailedGeneration(fg) {
  if (!fg) return []
  if (typeof fg !== 'string') return coercePages(fg)
  let pages = coercePages(fg)
  if (pages.length) return pages
  const m = fg.match(/"(?:arguments|parameters)"\s*:\s*([\s\S]*?)\s*\}\s*$/)
  if (m) pages = coercePages(m[1])
  return pages
}

/**
 * Ask Groq for a chunk of pages. Returns raw pages[] (also pages recovered from a
 * 400 tool_use_failed), null when the answer held none, or { chunkError: { status,
 * code } } when the call failed (generateHybridPages caps 400 retries on it).
 */
export async function fetchHybridChunk(plan, pages, feedback, stats, { client = groq, suggested = null } = {}) {
  const t0 = Date.now()
  try {
    const res = await callTool(client(), {
      model: MODELS.content,
      maxTokens: HYBRID_MAX_TOKENS,
      tool: hybridContentTool,
      messages: [{ role: 'user', content: buildHybridContentPrompt(plan, pages, feedback, suggested) }],
      label: 'Groq hybrid content',
      step: 'content',
    })
    const raws = coercePages(res.args)
    stats?.calls.push({ pages: pages.length, ms: Date.now() - t0, usage: res.usage ?? null, ok: raws.length > 0 })
    return raws.length ? raws : null
  } catch (err) {
    const code = err.error?.code ?? err.code
    const fg = err.error?.failed_generation
    const recovered = code === 'tool_use_failed' && fg ? pagesFromFailedGeneration(fg) : []
    // The FULL failed_generation goes to stats (eval fixtures); the log stays short.
    stats?.calls.push({ pages: pages.length, ms: Date.now() - t0, error: err.status ?? err.message, code, ...(fg ? { failedGeneration: fg } : {}), ...(recovered.length ? { recovered: recovered.length } : {}) })
    const nums = pages.map(p => p.pageNum).join(',')
    if (recovered.length) {
      console.warn(`hybrid content for pages ${nums}: ${err.status} ${code} — recovered ${recovered.length} page(s) from failed_generation`)
      return recovered
    }
    console.warn(`hybrid content for pages ${nums} failed (${err.status ?? err.message}${code ? ` ${code}` : ''}${err.error?.message ? `: ${String(err.error.message).slice(0, 120)}` : ''})`)
    return { chunkError: { status: err.status ?? null, code: code ?? null } }
  }
}

/**
 * Pair each planned page of a call with its raw answer: by pageNum (number or "5"),
 * else — when the answer has no pageNum — by position among the answers. `raws` may
 * be any shape coercePages reads. A page without a title gets the plan page's
 * (titleFromPage); one without a known layout gets inferLayout's (`layoutInferred`).
 * Pure.
 */
export function matchRawPages(group, raws = []) {
  const list = coercePages(raws)
  const numOf = (r) => { const n = Number(String(r.pageNum ?? '').match(/\d+/)?.[0]); return Number.isFinite(n) && String(r.pageNum ?? '').trim() !== '' ? n : null }
  const used = new Set()
  return group.map((page, i) => {
    let k = list.findIndex((r, j) => !used.has(j) && numOf(r) === page.pageNum)
    if (k < 0 && list[i] && !used.has(i) && numOf(list[i]) === null) k = i
    if (k < 0) return null
    used.add(k)
    const r = { ...list[k], pageNum: page.pageNum }
    if (!hasText(r.title)) r.title = titleFromPage(page)
    if (!HYBRID_LAYOUTS.includes(r.layout)) { r.layout = inferLayout(r, page); r.layoutInferred = true }
    return r
  })
}

/**
 * Generate structured content for every worksheet/activity page. Returns
 * { pages: Map(pageNum → content), failed: page[], log } — `failed` pages need the
 * legacy fallback. `fetchChunk` is injectable for tests and the live eval.
 */
export async function generateHybridPages(plan, contentPages, { fetchChunk = fetchHybridChunk, solveMatching, fetchReplacements, stats = null } = {}) {
  // Replacement pairs are a live Groq call: on by default only with the live content
  // fetcher, so tests that mock fetchChunk never reach the network.
  if (fetchReplacements === undefined) fetchReplacements = fetchChunk === fetchHybridChunk ? fetchReplacementPairsGroq : null
  const opts = (page) => ({ packageType: plan.packageType, plan, page: { ...page, title: page.title } })
  const done = new Map()
  const attempts = new Map(contentPages.map(p => [p.pageNum, []]))
  let pending = contentPages
  const feedback = new Map()
  const missing = new Set()
  const selfCheck = matchingSelfCheckEnabled()
  const ambiguous = new Map() // pageNum → latest valid-but-ambiguous matching attempt

  const bad400 = new Map() // pageNum → calls that failed with HTTP 400 and recovered nothing
  const gaveUp = [] // pages whose 400 retry also failed: straight to the legacy fallback
  // Set-wide variety: suggested layouts respect the per-layout cap, and accepted pages
  // (in acceptance order) are what later pages may not repeat.
  const suggested = assignLayouts(contentPages)
  const cap = layoutCap(contentPages.length)
  const accepted = [] // { pageNum, layout, sigs }
  const accept = (pageNum, n) => accepted.push({ pageNum, layout: n.layout, sigs: itemSignatures(n) })
  // Issues a page that is valid on its own still has within the set (duplicate / over cap).
  const setIssues = (n, attempt) => {
    const dup = duplicateOf(itemSignatures(n), accepted)
    if (dup) return [duplicateIssue(dup)]
    const used = accepted.filter(a => a.layout === n.layout).length
    // Soft on the last attempt: an over-cap page beats a degraded one.
    if (!CAP_EXEMPT.has(n.layout) && used >= cap && attempt < HYBRID_MAX_ATTEMPTS) {
      const counts = new Map()
      for (const a of accepted) counts.set(a.layout, (counts.get(a.layout) ?? 0) + 1)
      return [`this set already has ${used} ${n.layout} pages (max ${cap}) — use the ${surplusLayout(counts, cap, n.layout)} layout for this page`]
    }
    return []
  }

  for (let attempt = 1; attempt <= HYBRID_MAX_ATTEMPTS && pending.length; attempt++) {
    // Pages whose whole call failed (e.g. 400 tool_use_failed) are retried one per call,
    // so one malformed page cannot sink its neighbours again.
    const lost = pending.filter(p => missing.has(p.pageNum))
    const groups = [...chunk(pending.filter(p => !missing.has(p.pageNum)), HYBRID_PAGES_PER_CALL), ...chunk(lost, 1)]
    missing.clear()
    const results = await mapWithConcurrency(groups, recheckConcurrency(), g => fetchChunk(plan, g, feedback, stats, { suggested }))
    const is400 = (r) => r?.chunkError?.status === 400
    // Every call of the first round failed with 400 and nothing was recovered: Groq is
    // rejecting this plan's calls outright, so retrying page by page only burns tokens.
    if (attempt === 1 && groups.length && results.every(is400)) {
      console.warn(`hybrid content: every call failed with 400 — ${pending.length} page(s) go to the legacy prompt without retries`)
      gaveUp.push(...pending)
      pending = []
      break
    }
    const next = []
    const checked = []
    groups.forEach((group, gi) => {
      const res = results[gi]
      const failed400 = is400(res)
      const matched = matchRawPages(group, res?.chunkError ? [] : (res ?? []))
      for (const [pi, page] of group.entries()) {
        const raw = matched[pi]
        if (!raw) {
          stats?.pages.push({ pageNum: page.pageNum, attempt, layout: null, issues: [failed400 ? 'call failed (400)' : 'missing'] })
          if (failed400) {
            const n400 = (bad400.get(page.pageNum) ?? 0) + 1
            bad400.set(page.pageNum, n400)
            // A 400 page gets one retry (alone); a second 400 sends it to the legacy prompt.
            if (n400 > 1) { gaveUp.push(page); continue }
          }
          feedback.set(page.pageNum, [`no readable entry for this page — ${EXPECTED_SHAPE}`])
          missing.add(page.pageNum)
          next.push(page)
          continue
        }
        const n = normalizeHybridPage(raw)
        checked.push({ page, raw, n, issues: validateHybridPage(n, opts({ ...page, title: s(raw.title) })) })
        attempts.get(page.pageNum).push({ ...n, raw })
      }
    })
    // Matching pages that validated get the self-check (sequential, like every Groq call).
    const toSolve = selfCheck ? checked.filter(c => !c.issues.length && c.n.layout === 'matching') : []
    const solved = await mapWithConcurrency(toSolve, recheckConcurrency(), c => selfCheckMatching(plan, c.n.spec, { ...(solveMatching ? { solve: solveMatching } : {}), stats }))
    for (const [i, c] of toSolve.entries()) {
      const r = solved[i]
      if (r.error) {
        console.warn(`matching self-check p${c.page.pageNum} failed (${r.error}) — page kept unchecked`)
        addReviewNote('fallback', `p${c.page.pageNum}: matching self-check failed (${r.error}) — check that every meaning fits only one term`)
      } else if (r.ambiguous) {
        const drop = pairsToDrop(r.conflicts)
        const dropped = drop.map(j => c.n.spec.pairs[j])
        const kept = c.n.spec.pairs.filter((_, j) => !drop.includes(j))
        const pageOpts = opts({ ...c.page, title: s(c.raw.title) })
        const valid = (spec, repair) => { const n = { ...c.n, spec, repairs: [...c.n.repairs, repair] }; return validateHybridPage(n, pageOpts).length === 0 ? n : null }
        const droppedNames = dropped.map(p => `"${p.term}"`).join(', ')
        let n = null
        if (kept.length >= MATCHING_DROP_MIN_PAIRS) {
          n = valid({ ...c.n.spec, pairs: kept }, `dropped ${drop.length} ambiguous matching pair(s)`)
          if (n) addReviewNote('fallback', `p${c.page.pageNum}: matching self-check found overlapping meanings — dropped ${droppedNames}; ${kept.length} pairs remain`)
        } else if (fetchReplacements) {
          // Too few left: ask Groq for just the missing pairs; any failure → next attempt.
          n = await replacePairs({ plan, c, kept, dropped, valid, fetchReplacements, selfCheck, solveMatching, stats })
          if (n) addReviewNote('fallback', `p${c.page.pageNum}: matching self-check found overlapping meanings — replaced ${droppedNames} with ${n.spec.pairs.slice(kept.length).map(p => `"${p.term}"`).join(', ')}`)
        }
        if (n) c.n = n
        else {
          c.issues = r.issues
          ambiguous.set(c.page.pageNum, { ...c, offending: drop })
        }
      }
    }
    for (const c of checked) {
      const { page, raw, n } = c
      if (c.issues.length === 0) c.issues = setIssues(n, attempt)
      const { issues } = c
      stats?.pages.push({ pageNum: page.pageNum, attempt, layout: n.layout, issues, repairs: n.repairs, raw })
      if (issues.length === 0) {
        accept(page.pageNum, n)
        done.set(page.pageNum, { content: hybridPageContent(raw, n), repairs: n.repairs })
      } else {
        console.warn(`hybrid content p${page.pageNum} (${n.layout}, attempt ${attempt}/${HYBRID_MAX_ATTEMPTS}): ${issues.join('; ')}`)
        feedback.set(page.pageNum, issues.slice(0, 6))
        next.push(page)
      }
    }
    pending = next
  }

  const failed = []
  for (const page of [...pending, ...gaveUp].sort((a, b) => a.pageNum - b.pageNum)) {
    // Still ambiguous after every attempt: ship the last one without its offending
    // pairs if enough remain (the rest were confirmed unambiguous by the self-check).
    const amb = ambiguous.get(page.pageNum)
    const kept = amb && dropPairs(amb.n.spec, amb.offending)
    if (kept) {
      const n = { ...amb.n, spec: kept }
      if (validateHybridPage(n, opts({ ...page, title: s(amb.raw.title) })).length === 0) {
        accept(page.pageNum, n)
        done.set(page.pageNum, { content: hybridPageContent(amb.raw, n), repairs: [...n.repairs, `dropped ${amb.offending.length} ambiguous matching pair(s)`] })
        addReviewNote('fallback', `p${page.pageNum}: matching stayed ambiguous after ${HYBRID_MAX_ATTEMPTS} attempts — dropped ${amb.offending.map(i => `"${amb.n.spec.pairs[i].term}"`).join(', ')}; ${kept.pairs.length} pairs remain`)
        continue
      }
    }
    const tried = attempts.get(page.pageNum)
    // A colouring page whose tasks kept naming drawn details: ship the latest attempt
    // without those tasks (they are optional) rather than lose the colouring page.
    const art = [...tried].reverse().map(t => ({ t, n: repairActivityArt(t) })).find(({ t, n }) => n && validateHybridPage(n, opts({ ...page, title: s(t.raw?.title) })).length === 0)
    if (art) {
      accept(page.pageNum, art.n)
      done.set(page.pageNum, { content: hybridPageContent(art.t.raw, art.n), repairs: art.n.repairs })
      addReviewNote('fallback', `p${page.pageNum}: activity_art tasks kept naming details of the picture after ${HYBRID_MAX_ATTEMPTS} attempts — ${art.n.repairs.at(-1).replace(/^activity_art: /, '')}`)
      continue
    }
    const fb0 = questionsFallback(tried, opts({ ...page, title: s(tried[0]?.raw?.title) }))
    // A fallback that repeats an accepted page is no better than the duplicate itself.
    const fb = fb0 && !duplicateOf(itemSignatures(fb0), accepted) ? fb0 : null
    if (fb) {
      accept(page.pageNum, fb)
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
 * solveMatching (Groq matching self-check), check (Groq recheck), legacy
 * (async (plan, pages) → [{ pageNum, ...legacyContent }]).
 */
export async function generateHybridContent(plan, contentPages, { fetchChunk, solveMatching, fetchReplacements, check, legacy, stats } = {}) {
  const { pages, failed } = await generateHybridPages(plan, contentPages, { fetchChunk, solveMatching, fetchReplacements, stats })
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
    addReviewNote('fallback', `p${nums}: no valid hybrid layout after ${HYBRID_MAX_ATTEMPTS} attempts — legacy content used (${isHybridOnly() ? 'drawn by the hybrid-only code fallbacks' : 'P1 classifier or gpt-image-2 draws the page'})`)
    const legacyPages = legacy ? await legacy(plan, failed) : []
    for (const lp of legacyPages ?? []) { const { pageNum, ...content } = lp; out.set(pageNum, content) }
  }
  console.log(`Hybrid content: ${structured.length} structured page(s) [${structured.map(p => `${p.pageNum}:${p.content.layout}`).join(' ')}], ${failed.length} legacy`)
  return out
}
