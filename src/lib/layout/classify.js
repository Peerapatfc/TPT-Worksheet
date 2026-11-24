// Which hybrid layout (if any) can render a page from today's content shape
// ({ imageSpec, questions[{num, question, answer}] }) without the picture the
// gpt-image-2 path would draw. Only layouts that can be derived reliably from
// that shape are routed: questions, fill_blank and multiple_choice (options
// printed inline in the question, or True/False). Anything that needs a drawn
// picture, diagram, table, cut-out, matching columns or other page content
// returns { layout: null } and keeps the OpenAI renderer until structured
// content (P3) feeds the other layouts (matching, sorting, labeling, …).
import { validateLayoutSpec } from './specs.js'

// Questions that only make sense next to a drawn picture or activity layout.
const PICTURE_WORDS = /\b(pictures?|images?|illustrations?|shown|drawn|draw|drawing|colou?r(?:ed|ing)?|circle|cut|paste|glue|trace|match(?:ing)?|columns?|tables?|charts?|graphs?|diagrams?|labels?|labell?ed|shaded|shade|boxes|grid|maze|puzzle|map|section \d|look at|on the (?:page|left|right)|missing|below|above)\b/i
const ACTIVITY_VERB = /^\s*(?:draw|cut|colou?r|circle|trace|match|sort|label|paste|glue|connect|fill in the (?:boxes|chart|table))\b/i
// Questions that read something printed elsewhere on the page (a count, a list,
// a story, an icon) — the hybrid page would not print it. "How many legs does a
// spider have?" stays self-contained; "How many words are in each family?" does not.
const NEEDS_PAGE = [
  /\baccording to\b/i,
  /\bin each (?:family|group|row|column|set|box|basket|bag|list|jar|team)\b/i,
  /\b(?:icons?|symbols?|stickers?|arrows?|captions?|headers?|headings?|key|legend)\b/i,
  /\b(?:sentence|section|row|item|card|example|box|leaf|planet|step) (?:\d+|[A-H])\b/,
  /\b(?:the|this|that) (?:story|passage|poem|text|list|data|word bank|page|set|group)\b/i,
  /\bhow many\b[^?]*\b(?:are there|are shown|do you see|can you (?:see|find|count)|on (?:the|this) page)\b/i,
  /\b(?:first|second|third|fourth|fifth|last) (?:picture|image|word|row|column|box|one)\b/i,
]
const BLANK = /_{2,}/
const WORD_BANK = /\bword bank\b[^:]*:\s*([^\n.]+)/i
const MAX_BANK_WORD = 30

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Word bank listed in an imageSpec ("Word bank at bottom: lobe, vein, margin"), or null. Pure. */
export function parseWordBank(spec) {
  const m = String(spec ?? '').match(WORD_BANK)
  if (!m) return null
  const words = m[1].split(/[,;]|\s+\band\b\s+/).map(w => w.trim().replace(/^["“']|["”']$/g, '')).filter(Boolean)
  return words.length >= 2 ? words : null
}

/**
 * @returns {{ layout: 'questions'|'fill_blank'|null, reason?: string, wordBank?: string[] }}
 * Pure — exported for unit testing.
 */
export function classifyHybridLayout(page) {
  if (page?.type !== 'worksheet' && page?.type !== 'activity') return { layout: null, reason: `type ${page?.type}` }
  const qs = page.content?.questions ?? []
  if (!qs.length) return { layout: null, reason: 'no questions' }
  if (page.content?.chart) return { layout: null, reason: 'chart page' }
  if (qs.some(q => !String(q.question ?? '').trim() || String(q.answer ?? '').trim() === '')) return { layout: null, reason: 'empty question or answer' }
  const pictureQ = qs.find(q => PICTURE_WORDS.test(q.question) || ACTIVITY_VERB.test(q.question))
  if (pictureQ) return { layout: null, reason: `question ${pictureQ.num} needs a picture/activity layout` }
  const pageQ = qs.find(q => NEEDS_PAGE.some(re => re.test(q.question)))
  if (pageQ) return { layout: null, reason: `question ${pageQ.num} reads content printed elsewhere on the page` }

  const spec = String(page.content?.imageSpec ?? '').trim()
  const blanks = qs.filter(q => BLANK.test(q.question)).length
  if (blanks > 0 && blanks * 2 >= qs.length) {
    const answers = qs.map(q => String(q.answer).trim())
    let bank = spec ? parseWordBank(spec) : null
    if (spec && !bank) return { layout: null, reason: 'imageSpec has more than a word bank' }
    if (bank && !answers.every(a => bank.some(w => norm(w) === norm(a)))) return { layout: null, reason: 'answers not in word bank' }
    if (!bank && answers.every(a => a.length <= 20 && a.split(/\s+/).length <= 2)) {
      // Short single answers: print them as a bank (alphabetical, so order gives nothing away).
      bank = [...new Map(answers.map(a => [norm(a), a])).values()].sort((a, b) => a.localeCompare(b))
    }
    if (bank?.some(w => w.length > MAX_BANK_WORD)) return { layout: null, reason: 'word bank entry too long' }
    return { layout: 'fill_blank', wordBank: bank ?? [] }
  }
  if (spec) return { layout: null, reason: 'imageSpec present' }
  const mc = multipleChoiceSpec(qs)
  if (mc) return { layout: 'multiple_choice', spec: mc }
  return { layout: 'questions' }
}

const OPTION_SPLIT = /(?:^|\s)\(?([A-Da-d])[).]\s+/g
const TRUE_FALSE = /^\s*true\s+or\s+false\s*[:?.-]\s*/i

/**
 * Inline options in a question ("Which is largest? A) Mars B) Jupiter C) Venus"),
 * letters A, B[, C[, D]] in order. Returns { stem, options } or null. Pure.
 */
export function parseInlineOptions(question) {
  const text = String(question ?? '')
  const marks = [...text.matchAll(OPTION_SPLIT)]
  if (marks.length < 2 || marks.length > 4) return null
  if (marks.some((m, i) => m[1].toUpperCase() !== 'ABCD'[i])) return null
  const stem = text.slice(0, marks[0].index).trim()
  const options = marks.map((m, i) => text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim().replace(/[,;]$/, '').trim())
  if (!stem || options.some(o => !o || o.length > 60)) return null
  return { stem, options }
}

/**
 * multiple_choice spec when EVERY question carries its options inline or is a
 * "True or False: …" statement with a True/False answer, and the answer resolves to
 * exactly one option; otherwise null. Pure.
 */
export function multipleChoiceSpec(qs) {
  const questions = []
  for (const q of qs) {
    const tf = String(q.question).match(TRUE_FALSE)
    let item = null
    if (tf && /^(true|false)$/i.test(String(q.answer).trim())) {
      item = { num: q.num, question: String(q.question).slice(tf[0].length).trim(), options: ['True', 'False'], answer: String(q.answer).trim() }
    } else {
      const p = parseInlineOptions(q.question)
      if (!p) return null
      const answer = String(q.answer).trim().replace(/^\(?([A-Da-d])[).]\s+.*$/, '$1')
      item = { num: q.num, question: p.stem, options: p.options, answer }
    }
    questions.push(item)
  }
  const spec = { questions }
  return validateLayoutSpec('multiple_choice', spec).length ? null : spec
}
