// Hybrid worksheet/activity pages (PAGE_RENDERER=hybrid): the layout engine
// (src/lib/layout/) prints every word from the page data; FLUX adds one decorative
// spot illustration (or the large / colouring picture of labeling / activity_art).
// No vision QA or reconcile: the text is exact by construction.
import { renderSvg } from './svg-templates.js'
import { addReviewNote } from './review-notes.js'
import { renderLayout, LAYOUT_REGISTRY } from './layout/index.js'
import { pageIllustrationSubject, buildPageIllustrationPrompt, buildColoringPrompt } from './illustrations.js'

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

/** Build the page SVG for a classified layout. `spec` is the layout's typed spec (fill_blank: { wordBank }). Pure. */
export function hybridPageSvg(plan, page, { layout, wordBank, spec, art }) {
  return renderLayout(layout, plan, page, layout === 'fill_blank' ? { wordBank: wordBank ?? spec?.wordBank ?? [] } : spec, { art })
}

/** FLUX prompt + subject for a layout's illustration, or null when it draws none. Pure. */
export function illustrationRequest(plan, page, layout, spec) {
  const kind = LAYOUT_REGISTRY[layout]?.art
  if (kind === 'none' || !kind) return null
  if (kind === 'lineart') return { subject: spec.subject, prompt: buildColoringPrompt(spec.subject) }
  const subject = kind === 'large' ? spec.subject : pageIllustrationSubject(plan, page)
  return { subject, prompt: buildPageIllustrationPrompt(subject) }
}

/**
 * Render one hybrid page to PNG. A FLUX failure never blocks the page: it is
 * rendered with a decorative SVG motif block in the illustration slot and a
 * `fallback` review note. LayoutOverflowError (content too long for the page even
 * at the minimum size) propagates so the caller can use another renderer.
 *
 * @param {{ layout: string, wordBank?: string[], spec?: object, illustrations: { get(prompt: string): Promise<object> } }} opts
 * @returns {Promise<{ buffer: Buffer, meta: object }>}
 */
export async function renderHybridPage(plan, page, { layout, wordBank = [], spec = null, illustrations }) {
  const req = illustrationRequest(plan, page, layout, spec)
  const opts = { layout, wordBank, spec }
  if (!req) {
    const out = hybridPageSvg(plan, page, { ...opts, art: null })
    return { buffer: await renderSvg(out.svg), meta: { ...out.meta, layout } }
  }
  // The slot does not depend on the picture's size, so a dry layout tells whether the
  // page has room for art at all — if not, skip the FLUX call.
  const dry = hybridPageSvg(plan, page, { ...opts, art: true })
  if (dry.meta.art === 'dropped') {
    return { buffer: await renderSvg(hybridPageSvg(plan, page, { ...opts, art: null }).svg), meta: { ...dry.meta, layout, subject: req.subject } }
  }
  let art
  try {
    art = { ill: await illustrations.get(req.prompt) }
  } catch (err) {
    console.warn(`p${page.pageNum}: FLUX illustration failed (${err.message}) — drawing decorative motifs instead`)
    addReviewNote('fallback', `p${page.pageNum} (${page.filename}): illustration failed (${err.message}); page drawn with decorative motifs`)
    art = true
  }
  const out = hybridPageSvg(plan, page, { ...opts, art })
  return { buffer: await renderSvg(out.svg), meta: { ...out.meta, layout, subject: req.subject } }
}
