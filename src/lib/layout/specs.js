// Typed page specs for the P2 hybrid layouts: validators (code, deterministic),
// the deterministic shuffles the layouts print, and the answer-key questions each
// layout derives from its spec. The renderers in this directory only accept a
// spec that validates; answer keys come from here, never from a model, so the
// key always matches the printed page.
//
// Spec shapes (P3 will ask Groq for exactly these):
//   multiple_choice { questions: [{ num, question, options: [2–4 strings], answer: option text or letter }] }
//   matching        { pairs: [{ term, match }] (3–10) }            — code shuffles the right column
//   sorting         { categories: [2–4 strings], items: [{ word, category }] (4–16) }
//   labeling        { subject, labels: [{ word, clue }] (3–8) }    — word bank + numbered clue callouts
//   table_fill      { columns: [2–5 strings], rows: [[string | { answer }]] (2–10), questions?: [{ num, question, answer }] }
//   shapes          { items: [ShapeItem] (1–9) }                   — drawn by code, answers derived
//   activity_art    { subject, instruction, tasks?: [≤3 strings] }
import { CHART_ICONS } from '../chart-page.js'
import { cleanText } from './measure.js'

export const LIMITS = {
  options: { min: 2, max: 4 },
  mcQuestions: { min: 1, max: 12 },
  pairs: { min: 3, max: 10 },
  categories: { min: 2, max: 4 },
  items: { min: 4, max: 16 },
  labels: { min: 3, max: 8 },
  columns: { min: 2, max: 5 },
  rows: { min: 2, max: 10 },
  shapes: { min: 1, max: 9 },
  parts: { min: 2, max: 12 },
  count: { min: 1, max: 20 },
  tasks: { max: 3 },
  word: 30, // word-bank / sort item length
  term: 40,
  text: 160, // question, clue, meaning, option
}

export const POLYGONS = { triangle: 3, square: 4, rectangle: 4, rhombus: 4, trapezoid: 4, pentagon: 5, hexagon: 6, octagon: 8, circle: 0 }
const ALSO_ACCEPT = { square: 'rectangle, rhombus, quadrilateral', rectangle: 'quadrilateral', rhombus: 'quadrilateral', trapezoid: 'quadrilateral' }
export const FRACTION_SHAPES = ['circle', 'rectangle', 'bar']
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

const str = (v) => cleanText(v).trim()
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ')
const isArr = (v, min, max) => Array.isArray(v) && v.length >= min && v.length <= max
const dupes = (list) => list.length !== new Set(list.map(norm)).size

// ── Deterministic shuffle ────────────────────────────────────────────────────
/** 32-bit FNV-1a hash of a string. Pure. */
export function hashString(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}
/**
 * Permutation of 0..n-1 seeded by `key` (same key → same order on every run).
 * With `derange`, no index stays in place (n ≥ 2), so a matching column never
 * lines up with its answers. Pure.
 */
export function seededOrder(n, key, { derange = false } = {}) {
  const rnd = mulberry32(hashString(key))
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
    if (!derange || n < 2 || p.every((v, i) => v !== i)) return p
  }
  return Array.from({ length: n }, (_, i) => (i + 1) % n) // rotation: always a derangement
}

// ── Validators: each returns a list of errors ([] = valid). Pure. ───────────
function optionIndex(q) {
  const a = str(q.answer)
  const letter = a.match(/^\(?([A-Da-d])[).:]?$/)
  if (letter) {
    const i = LETTERS.indexOf(letter[1].toUpperCase())
    return i < q.options.length ? i : -1
  }
  const hits = q.options.map((o, i) => (norm(o) === norm(a) ? i : -1)).filter(i => i >= 0)
  return hits.length === 1 ? hits[0] : -1
}

function validateQuestions(qs, errs, label = 'questions') {
  if (!Array.isArray(qs)) return errs.push(`${label} must be an array`)
  qs.forEach((q, i) => {
    if (!str(q?.question)) errs.push(`${label}[${i}] has no question`)
    if (!str(q?.answer)) errs.push(`${label}[${i}] has no answer`)
    if (str(q?.question).length > LIMITS.text * 2) errs.push(`${label}[${i}] question too long`)
  })
}

const VALIDATORS = {
  multiple_choice(spec, errs) {
    const qs = spec?.questions
    if (!isArr(qs, LIMITS.mcQuestions.min, LIMITS.mcQuestions.max)) return errs.push(`questions: ${LIMITS.mcQuestions.min}–${LIMITS.mcQuestions.max} required`)
    validateQuestions(qs, errs)
    qs.forEach((q, i) => {
      if (!isArr(q?.options, LIMITS.options.min, LIMITS.options.max)) return errs.push(`questions[${i}].options: ${LIMITS.options.min}–${LIMITS.options.max} required`)
      if (q.options.some(o => !str(o) || str(o).length > LIMITS.text)) errs.push(`questions[${i}] has an empty or too long option`)
      if (dupes(q.options)) errs.push(`questions[${i}] has duplicate options`)
      else if (optionIndex(q) < 0) errs.push(`questions[${i}].answer "${str(q.answer)}" is not exactly one of its options`)
    })
  },
  matching(spec, errs) {
    const pairs = spec?.pairs
    if (!isArr(pairs, LIMITS.pairs.min, LIMITS.pairs.max)) return errs.push(`pairs: ${LIMITS.pairs.min}–${LIMITS.pairs.max} required`)
    pairs.forEach((p, i) => {
      if (!str(p?.term) || str(p.term).length > LIMITS.term) errs.push(`pairs[${i}].term empty or longer than ${LIMITS.term}`)
      if (!str(p?.match) || str(p.match).length > LIMITS.text) errs.push(`pairs[${i}].match empty or longer than ${LIMITS.text}`)
    })
    // A bijection: no term or match may repeat, or two answers would be correct.
    if (dupes(pairs.map(p => p?.term ?? ''))) errs.push('pairs have duplicate terms')
    if (dupes(pairs.map(p => p?.match ?? ''))) errs.push('pairs have duplicate matches')
  },
  sorting(spec, errs) {
    const cats = spec?.categories
    if (!isArr(cats, LIMITS.categories.min, LIMITS.categories.max)) return errs.push(`categories: ${LIMITS.categories.min}–${LIMITS.categories.max} required`)
    if (cats.some(c => !str(c) || str(c).length > LIMITS.term)) errs.push('a category is empty or too long')
    if (dupes(cats)) errs.push('duplicate categories')
    const items = spec?.items
    if (!isArr(items, LIMITS.items.min, LIMITS.items.max)) return errs.push(`items: ${LIMITS.items.min}–${LIMITS.items.max} required`)
    if (dupes(items.map(it => it?.word ?? ''))) errs.push('duplicate items')
    items.forEach((it, i) => {
      if (!str(it?.word) || str(it.word).length > LIMITS.word) errs.push(`items[${i}].word empty or longer than ${LIMITS.word}`)
      if (cats.filter(c => norm(c) === norm(it?.category)).length !== 1) errs.push(`items[${i}].category "${str(it?.category)}" is not one of the categories`)
    })
    for (const c of cats) if (!items.some(it => norm(it?.category) === norm(c))) errs.push(`category "${str(c)}" has no items`)
  },
  labeling(spec, errs) {
    if (!str(spec?.subject)) errs.push('subject required')
    const labels = spec?.labels
    if (!isArr(labels, LIMITS.labels.min, LIMITS.labels.max)) return errs.push(`labels: ${LIMITS.labels.min}–${LIMITS.labels.max} required`)
    labels.forEach((l, i) => {
      if (!str(l?.word) || str(l.word).length > LIMITS.word) errs.push(`labels[${i}].word empty or longer than ${LIMITS.word}`)
      if (!str(l?.clue) || str(l.clue).length > LIMITS.text) errs.push(`labels[${i}].clue empty or longer than ${LIMITS.text}`)
      else if (norm(l.clue).includes(norm(l.word))) errs.push(`labels[${i}].clue gives away its word`)
    })
    if (dupes(labels.map(l => l?.word ?? ''))) errs.push('duplicate label words')
  },
  table_fill(spec, errs) {
    const cols = spec?.columns
    if (!isArr(cols, LIMITS.columns.min, LIMITS.columns.max)) return errs.push(`columns: ${LIMITS.columns.min}–${LIMITS.columns.max} required`)
    if (cols.some(c => !str(c) || str(c).length > LIMITS.term)) errs.push('a column header is empty or too long')
    const rows = spec?.rows
    if (!isArr(rows, LIMITS.rows.min, LIMITS.rows.max)) return errs.push(`rows: ${LIMITS.rows.min}–${LIMITS.rows.max} required`)
    let blanks = 0
    rows.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== cols.length) return errs.push(`rows[${i}] must have ${cols.length} cells`)
      r.forEach((c, j) => {
        if (c && typeof c === 'object') {
          blanks++
          if (!str(c.answer) || str(c.answer).length > LIMITS.word) errs.push(`rows[${i}][${j}] blank has no (or a too long) answer`)
        } else if (str(c).length > LIMITS.term) errs.push(`rows[${i}][${j}] longer than ${LIMITS.term}`)
      })
    })
    if (!blanks) errs.push('table has no blank cell')
    if (spec.questions !== undefined) validateQuestions(spec.questions, errs)
  },
  shapes(spec, errs) {
    const items = spec?.items
    if (!isArr(items, LIMITS.shapes.min, LIMITS.shapes.max)) return errs.push(`items: ${LIMITS.shapes.min}–${LIMITS.shapes.max} required`)
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
    items.forEach((it, i) => {
      if (it?.kind === 'fraction') {
        if (!FRACTION_SHAPES.includes(it.shape)) errs.push(`items[${i}].shape must be one of ${FRACTION_SHAPES.join(', ')}`)
        if (!int(it.parts, LIMITS.parts.min, LIMITS.parts.max)) errs.push(`items[${i}].parts must be ${LIMITS.parts.min}–${LIMITS.parts.max}`)
        if (!['name', 'shade'].includes(it.ask)) errs.push(`items[${i}].ask must be name or shade`)
        if (!int(it.shaded, it.ask === 'shade' ? 1 : 0, it.parts ?? 0)) errs.push(`items[${i}].shaded must be ${it.ask === 'shade' ? 1 : 0}–parts`)
      } else if (it?.kind === 'count') {
        if (!CHART_ICONS.includes(it.icon)) errs.push(`items[${i}].icon must be one of ${CHART_ICONS.join(', ')}`)
        if (!int(it.count, LIMITS.count.min, LIMITS.count.max)) errs.push(`items[${i}].count must be ${LIMITS.count.min}–${LIMITS.count.max}`)
      } else if (it?.kind === 'polygon') {
        if (!(it.shape in POLYGONS)) errs.push(`items[${i}].shape must be one of ${Object.keys(POLYGONS).join(', ')}`)
        if (!['sides', 'corners', 'name'].includes(it.ask)) errs.push(`items[${i}].ask must be sides, corners or name`)
        else if (it.shape === 'circle' && it.ask !== 'name') errs.push(`items[${i}]: a circle can only ask for its name`)
      } else errs.push(`items[${i}].kind must be fraction, count or polygon`)
    })
  },
  activity_art(spec, errs) {
    if (!str(spec?.subject)) errs.push('subject required')
    if (!str(spec?.instruction) || str(spec.instruction).length > LIMITS.text) errs.push('instruction empty or too long')
    if (spec?.tasks !== undefined && (!isArr(spec.tasks, 0, LIMITS.tasks.max) || spec.tasks.some(t => !str(t) || str(t).length > LIMITS.text))) errs.push(`tasks: at most ${LIMITS.tasks.max} non-empty lines`)
  },
}

export const LAYOUTS = Object.keys(VALIDATORS)

/** Errors for a layout spec ([] = renderable). Pure. */
export function validateLayoutSpec(layout, spec) {
  const v = VALIDATORS[layout]
  if (!v) return [`unknown layout ${layout}`]
  const errs = []
  v(spec ?? {}, errs)
  return errs
}

// ── Derived content (what the page prints, in order) ─────────────────────────
/** Right-column order of a matching page: indices into pairs. Pure. */
export const matchingOrder = (spec) => seededOrder(spec.pairs.length, `match|${spec.pairs.map(p => norm(p.term)).join('|')}`, { derange: true })
/** Sort-bank order of a sorting page: indices into items. Pure. */
export const sortingOrder = (spec) => seededOrder(spec.items.length, `sort|${spec.items.map(it => norm(it.word)).join('|')}`, { derange: true })
/** Word-bank order of a labeling page: indices into labels. Pure. */
export const labelingBankOrder = (spec) => seededOrder(spec.labels.length, `label|${spec.labels.map(l => norm(l.word)).join('|')}`, { derange: true })
/** Option index (0-based) a multiple-choice answer resolves to, or -1. Pure. */
export const mcAnswerIndex = optionIndex

const plural = (n, word) => (n === 1 ? word : /(?:s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`)

/** Question text and answer the shapes layout prints for one item. Pure. */
export function shapeItemQA(it) {
  if (it.kind === 'fraction') {
    return it.ask === 'shade'
      ? { question: `Shade ${it.shaded}/${it.parts} of the ${it.shape}.`, answer: `${it.shaded} of ${it.parts} parts shaded` }
      : { question: 'What fraction is shaded?', answer: `${it.shaded}/${it.parts}` }
  }
  if (it.kind === 'count') return { question: `How many ${plural(2, it.icon)}?`, answer: String(it.count) }
  const n = POLYGONS[it.shape]
  if (it.ask === 'sides') return { question: 'How many sides?', answer: String(n) }
  if (it.ask === 'corners') return { question: 'How many corners?', answer: String(n) }
  // A square is also a rectangle and a rhombus; every 4-sided shape is a quadrilateral.
  const also = ALSO_ACCEPT[it.shape]
  return { question: 'What is the name of this shape?', answer: also ? `${it.shape} (also accept: ${also})` : it.shape }
}

/**
 * Answer-key questions ({ num, question, answer }) derived from a valid spec, in
 * the order the page prints them. answerKeySvg renders these unchanged. Pure.
 */
export function layoutAnswerKey(layout, spec) {
  switch (layout) {
    case 'multiple_choice':
      return spec.questions.map(q => {
        const i = optionIndex(q)
        return { num: q.num, question: str(q.question), answer: `${LETTERS[i]}. ${str(q.options[i])}` }
      })
    case 'matching': {
      const order = matchingOrder(spec)
      return spec.pairs.map((p, i) => ({ num: i + 1, question: str(p.term), answer: `${LETTERS[order.indexOf(i)]}. ${str(p.match)}` }))
    }
    case 'sorting':
      return spec.categories.map((c, i) => ({
        num: i + 1, question: str(c),
        answer: spec.items.filter(it => norm(it.category) === norm(c)).map(it => str(it.word)).join(', '),
      }))
    case 'labeling':
      return spec.labels.map((l, i) => ({ num: i + 1, question: str(l.clue), answer: str(l.word) }))
    case 'table_fill': {
      const out = []
      spec.rows.forEach((r, i) => r.forEach((c, j) => {
        if (c && typeof c === 'object') out.push({ num: out.length + 1, question: `${str(spec.columns[j])} — row ${i + 1}${typeof r[0] === 'string' && j > 0 ? ` (${str(r[0])})` : ''}`, answer: str(c.answer) })
      }))
      for (const q of spec.questions ?? []) out.push({ num: out.length + 1, question: str(q.question), answer: str(q.answer) })
      return out
    }
    case 'shapes':
      return spec.items.map((it, i) => ({ num: i + 1, ...shapeItemQA(it) }))
    case 'activity_art':
      return []
    default:
      throw new Error(`unknown layout ${layout}`)
  }
}
