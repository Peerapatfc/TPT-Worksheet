// Hybrid worksheet/activity pages (PAGE_RENDERER=hybrid, P1): the layout engine
// (src/lib/layout/) prints every word from the Q&A data, FLUX adds one decorative
// spot illustration. No vision QA or reconcile: the text is exact by construction.
import { renderSvg } from './svg-templates.js'
import { addReviewNote } from './review-notes.js'
import { questionsPageSvg, fillBlankPageSvg } from './layout/worksheet.js'
import { pageIllustrationSubject, buildPageIllustrationPrompt } from './illustrations.js'

/**
 * PAGE_RENDERER → 'hybrid' | 'openai'. Unset/empty = 'openai' (default);
 * unknown values fall back to 'openai' with a warning. Pure apart from the warning.
 */
export function pageRenderer(env = process.env) {
  const v = String(env.PAGE_RENDERER ?? '').trim().toLowerCase()
  if (!v || v === 'openai') return 'openai'
  if (v === 'hybrid') return 'hybrid'
  console.warn(`Unknown PAGE_RENDERER "${v}" — using openai`)
  return 'openai'
}

/** Build the page SVG for a classified layout. Pure. */
export function hybridPageSvg(plan, page, { layout, wordBank, art }) {
  if (layout === 'fill_blank') return fillBlankPageSvg(plan, page, { art, wordBank })
  if (layout === 'questions') return questionsPageSvg(plan, page, { art })
  throw new Error(`unknown hybrid layout ${layout}`)
}

/**
 * Render one hybrid page to PNG. A FLUX failure never blocks the page: it is
 * rendered with a decorative SVG motif block in the illustration slot and a
 * `fallback` review note. LayoutOverflowError (content too long for the page even
 * at the minimum size) propagates so the caller can use another renderer.
 *
 * @param {{ layout: string, wordBank?: string[], illustrations: { get(prompt: string): Promise<object> } }} opts
 * @returns {Promise<{ buffer: Buffer, meta: object }>}
 */
export async function renderHybridPage(plan, page, { layout, wordBank = [], illustrations }) {
  const subject = pageIllustrationSubject(plan, page)
  // The slot does not depend on the picture's size, so a dry layout tells whether the
  // page has room for art at all — if not, skip the FLUX call.
  const dry = hybridPageSvg(plan, page, { layout, wordBank, art: true })
  if (dry.meta.art === 'dropped') {
    return { buffer: await renderSvg(hybridPageSvg(plan, page, { layout, wordBank, art: null }).svg), meta: { ...dry.meta, layout, subject } }
  }
  let art
  try {
    art = { ill: await illustrations.get(buildPageIllustrationPrompt(subject)) }
  } catch (err) {
    console.warn(`p${page.pageNum}: FLUX illustration failed (${err.message}) — drawing decorative motifs instead`)
    addReviewNote('fallback', `p${page.pageNum} (${page.filename}): illustration failed (${err.message}); page drawn with decorative motifs`)
    art = true
  }
  const out = hybridPageSvg(plan, page, { layout, wordBank, art })
  return { buffer: await renderSvg(out.svg), meta: { ...out.meta, layout, subject } }
}
