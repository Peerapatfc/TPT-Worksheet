// PAGE_RENDERER=hybrid-only: every worksheet/activity page is drawn by code (+ an
// optional FLUX illustration) and NOTHING may call OpenAI. Where `hybrid` would hand
// a page to gpt-image-2 (no layout fits, picture-dependent legacy content, layout
// overflow, render error), this module degrades instead, in this order:
//   1. the routed layout (structured hybrid content, or the P1/P2 classifier);
//   2. a self-contained conversion of a structured spec (matching / labeling →
//      fill-in with a word bank, multiple choice / sorting → plain questions);
//   3. the plain `questions` layout from the page's Q&A (picture-dependent legacy
//      questions dropped when ≥ MIN_KEEP remain, renumbered);
//   4. the compact layout (16 → 14px, no art, one writing line, two columns), trimming
//      trailing questions until it fits;
//   5. a colouring page (no questions) and, if even that throws, a bare frame.
// It never throws and always returns a page; the content actually printed is returned
// with it so the answer key matches. Every degradation records a review note
// (`degraded` = content changed, `overflow` = shrunk/trimmed to fit).
import { renderHybridPage } from './hybrid-page.js'
import { renderSvg } from './svg-templates.js'
import { compactQuestionsPageSvg, shell, pageDoc } from './layout/worksheet.js'
import { classifyHybridLayout, questionNeedsPage } from './layout/classify.js'
import { LayoutOverflowError } from './layout/measure.js'
import { pageIllustrationSubject } from './illustrations.js'
import { addReviewNote } from './review-notes.js'

/** Fewest self-contained questions worth keeping after dropping picture-dependent ones. */
export const MIN_KEEP = 4
const LETTERS = 'ABCDEFGHIJ'
const str = (s) => String(s ?? '').trim()
const QUOTE = /["“]([^"”]{2,})["”]/g
const renumber = (qs) => qs.map((q, i) => ({ ...q, num: i + 1 }))
const sortedBank = (words) => [...new Map(words.map(w => [str(w).toLowerCase(), str(w)])).values()].sort((a, b) => a.localeCompare(b))

/**
 * Split legacy Q&A into questions that stand on their own and ones that need the
 * picture / imageSpec text the hybrid page will not print (classifier word tests, or
 * a quotation that only the imageSpec contains). Pure.
 * @returns {{ keep: object[], dropped: object[] }}
 */
export function splitDependentQuestions(content) {
  const spec = str(content?.imageSpec).toLowerCase()
  const quotesSpec = (q) => spec && [...str(q.question).matchAll(QUOTE)].some(m => spec.includes(m[1].trim().toLowerCase()))
  const keep = []
  const dropped = []
  for (const q of content?.questions ?? []) (questionNeedsPage(q.question) || quotesSpec(q) ? dropped : keep).push(q)
  return { keep, dropped }
}

/**
 * Self-contained Q&A for a structured layout that could not be drawn, or null when
 * the layout has no faithful text-only form (table_fill, shapes and labeling-without-
 * clues read the drawn page). Pure.
 * @returns {{ layout: 'questions'|'fill_blank', questions: object[], wordBank?: string[] } | null}
 */
export function plainFormOf(layout, spec) {
  switch (layout) {
    case 'multiple_choice':
      return {
        layout: 'questions',
        questions: spec.questions.map((q, i) => {
          const opts = q.options.map(str)
          const idx = /^[A-D]$/i.test(str(q.answer)) ? LETTERS.indexOf(str(q.answer).toUpperCase()) : opts.findIndex(o => o.toLowerCase() === str(q.answer).toLowerCase())
          return { num: i + 1, question: `${str(q.question)} ${opts.map((o, j) => `${LETTERS[j]}) ${o}`).join('  ')}`, answer: idx >= 0 ? `${LETTERS[idx]}. ${opts[idx]}` : str(q.answer) }
        }),
      }
    case 'matching':
      // Answers become the matched words (no column letters), from an alphabetical bank.
      return { layout: 'fill_blank', wordBank: sortedBank(spec.pairs.map(p => p.match)), questions: spec.pairs.map((p, i) => ({ num: i + 1, question: `${str(p.term)}: ___`, answer: str(p.match) })) }
    case 'labeling':
      if (spec.labels.some(l => !str(l.clue))) return null
      return { layout: 'fill_blank', wordBank: sortedBank(spec.labels.map(l => l.word)), questions: spec.labels.map((l, i) => ({ num: i + 1, question: `${str(l.clue)} ___`, answer: str(l.word) })) }
    case 'sorting': {
      const cats = spec.categories.map(str)
      return { layout: 'questions', questions: spec.items.map((it, i) => ({ num: i + 1, question: `Which group does "${str(it.word)}" belong to: ${cats.join(', ')}?`, answer: str(it.category) })) }
    }
    default:
      return null
  }
}

/** Content object for a converted attempt (layout + questions, no imageSpec). */
const convertedContent = (content, form) => ({
  ...content,
  layout: form.layout,
  spec: form.layout === 'fill_blank' ? { wordBank: form.wordBank ?? [] } : {},
  questions: form.questions,
  imageSpec: '',
})

/** Colouring-page attempt for a page with nothing printable (no questions). */
function colouringAttempt(plan, page, why) {
  const spec = { subject: pageIllustrationSubject(plan, page), instruction: 'Colour the picture. Add your own details to the background.' }
  return {
    layout: 'activity_art', spec,
    content: { ...(page.content ?? {}), layout: 'activity_art', spec, questions: [], imageSpec: '' },
    notes: [['degraded', `p${page.pageNum} (${page.filename}): ${why} — drawn as a colouring page with no questions (no answer-key entries)`]],
  }
}

/**
 * Ordered render attempts for a hybrid-only page. Each is { layout, spec?, wordBank?,
 * content?, notes } — `content` replaces page.content when that attempt renders, and
 * `notes` are recorded only for the attempt that is used. Pure.
 */
export function hybridOnlyAttempts(plan, page, route = {}) {
  const content = page.content ?? {}
  const tag = `p${page.pageNum} (${page.filename})`
  const attempts = []
  if (route.layout) attempts.push({ layout: route.layout, spec: route.spec, wordBank: route.wordBank, notes: [] })

  // Structured spec → self-contained text form.
  if (route.layout && route.spec && content.layout === route.layout) {
    const form = plainFormOf(route.layout, route.spec)
    if (form) attempts.push({ layout: form.layout, wordBank: form.wordBank, content: convertedContent(content, form), notes: [['degraded', `${tag}: ${route.layout} layout did not fit — printed as ${form.layout === 'fill_blank' ? 'fill-in sentences with a word bank' : 'plain questions'}`]] })
  }

  // Plain Q&A → questions layout (dropping questions that need the picture).
  const qs = content.questions ?? []
  if (qs.length && route.layout !== 'questions') {
    const structured = content.layout && content.layout !== 'questions' && content.layout !== 'fill_blank'
    const { keep, dropped } = splitDependentQuestions(content)
    let questions = qs
    let note = null
    if (!dropped.length) {
      if (!route.layout && str(content.imageSpec)) note = `${tag}: no picture is drawn in hybrid-only mode and the imageSpec is not printed — questions kept as they are; check none relies on it`
    } else if (keep.length >= MIN_KEEP) {
      questions = renumber(keep)
      note = `${tag}: dropped ${dropped.length} question(s) that needed the picture (${dropped.map(q => `#${q.num}`).join(', ')}); ${keep.length} kept, renumbered, answer key matches`
    } else {
      note = `${tag}: ${dropped.length} of ${qs.length} questions refer to a picture/page content that hybrid-only does not draw (${dropped.map(q => `#${q.num}`).join(', ')}) — printed anyway; fix or replace them`
    }
    // Structured layouts' content.questions are answer-key rows (they read the drawn
    // spec), so printing them as questions is only safe when none needs the page.
    if (!structured || !dropped.length) {
      const asQuestions = { ...content, layout: 'questions', spec: {}, questions, imageSpec: '' }
      const c = classifyHybridLayout({ ...page, content: asQuestions })
      const layout = c.layout && c.layout !== 'multiple_choice' && c.layout !== route.layout ? c.layout : 'questions'
      attempts.push({
        layout, wordBank: c.wordBank,
        content: layout === 'fill_blank' ? { ...asQuestions, layout, spec: { wordBank: c.wordBank ?? [] } } : asQuestions,
        notes: [...(note ? [['degraded', note]] : []), ...(route.layout ? [['overflow', `${tag}: ${route.layout} layout did not fit — printed as a plain ${layout} page`]] : [])],
      })
    }
  }
  if (!attempts.length) attempts.push(colouringAttempt(plan, page, qs.length ? 'no layout could print its questions' : 'no questions'))
  return attempts
}

/** Compact last resort: trims trailing questions until the compact layout fits. Pure. */
export function compactPage(plan, page, questions) {
  for (let n = questions.length; n >= 1; n--) {
    const pg = { ...page, content: { ...(page.content ?? {}), layout: 'questions', spec: {}, questions: questions.slice(0, n), imageSpec: '' } }
    try {
      return { page: pg, out: compactQuestionsPageSvg(plan, pg), dropped: questions.length - n }
    } catch (err) {
      if (!(err instanceof LayoutOverflowError)) throw err
    }
  }
  return null
}

/**
 * Render one worksheet/activity page in hybrid-only mode. Never throws, never calls
 * OpenAI. `hybrid` (renderHybridPage) is injectable for tests.
 * @returns {Promise<{ page: object, buffer: Buffer, meta: object }>} `page` carries the content actually printed
 */
export async function renderHybridOnlyPage(plan, page, route, { illustrations, hybrid = renderHybridPage } = {}) {
  const tag = `p${page.pageNum} (${page.filename})`
  const failures = []
  // Questions safe to print on their own for the compact last resort: only those of
  // a questions/fill_blank attempt (structured layouts' content.questions are
  // answer-key rows that read the drawn spec, e.g. "Length — row 2").
  let lastQuestions = []
  for (const a of hybridOnlyAttempts(plan, page, route)) {
    const pg = a.content ? { ...page, content: a.content } : page
    if ((a.layout === 'questions' || a.layout === 'fill_blank') && pg.content?.questions?.length) lastQuestions = pg.content.questions
    try {
      const { buffer, meta } = await hybrid(plan, pg, { layout: a.layout, wordBank: a.wordBank ?? [], spec: a.spec ?? pg.content?.spec ?? null, illustrations })
      for (const [kind, msg] of a.notes) addReviewNote(kind, failures.length && kind === 'overflow' ? `${msg} (${failures.join('; ')})` : msg)
      if (failures.length && !a.notes.some(([k]) => k === 'overflow')) addReviewNote('overflow', `${tag}: rendered as ${a.layout} after: ${failures.join('; ')}`)
      return { page: pg, buffer, meta: { ...meta, layout: a.layout } }
    } catch (err) {
      failures.push(`${a.layout} ${err instanceof LayoutOverflowError ? 'overflowed' : `failed (${err.message})`}`)
      console.log(`${tag}: hybrid-only ${a.layout} ${err instanceof LayoutOverflowError ? 'overflowed' : `failed: ${err.message}`} — trying the next fallback`)
    }
  }

  try {
    if (lastQuestions.length) {
      const c = compactPage(plan, page, renumber(lastQuestions))
      if (c) {
        addReviewNote('overflow', `${tag}: compact layout (${c.out.meta.size}px, no illustration) after: ${failures.join('; ')}${c.dropped ? ` — ${c.dropped} trailing question(s) trimmed to fit; answer key matches` : ''}`)
        return { page: c.page, buffer: await renderSvg(c.out.svg), meta: { ...c.out.meta, layout: 'compact' } }
      }
    }
    const art = colouringAttempt(plan, page, `nothing fitted (${failures.join('; ')})`)
    const pg = { ...page, content: art.content }
    const { buffer, meta } = await hybrid(plan, pg, { layout: art.layout, spec: art.spec, illustrations })
    art.notes.forEach(([k, m]) => addReviewNote(k, m))
    return { page: pg, buffer, meta: { ...meta, layout: art.layout } }
  } catch (err) {
    // Last line: a bare frame with the page title — still a page, never OpenAI.
    console.warn(`${tag}: every hybrid-only fallback failed (${err.message}) — bare frame page`)
    addReviewNote('degraded', `${tag}: every hybrid-only fallback failed (${err.message}) — printed as an empty framed page; replace it before listing`)
    const pg = { ...page, content: { ...(page.content ?? {}), questions: [] } }
    const sh = shell(plan, pg, 'Use this page for notes and drawing.')
    return { page: pg, buffer: await renderSvg(pageDoc(sh.svg)), meta: { layout: 'blank' } }
  }
}
