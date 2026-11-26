// PAGE_RENDERER flag, shared by every step (and by the OpenAI client guard).
//   openai       (default / unset / empty) every cover/worksheet/activity page on gpt-image-2
//   hybrid       code layouts + FLUX where a layout fits; anything else falls back to gpt-image-2
//   hybrid-only  zero-OpenAI mode: every page, the cover and the marketing cover are drawn by
//                code (+ FLUX); vision QA/reconcile never run; openai() throws.

/**
 * PAGE_RENDERER → 'openai' | 'hybrid' | 'hybrid-only'. Unknown values fall back to
 * 'openai' with a warning. Pure apart from the warning.
 */
export function pageRenderer(env = process.env, { warn = console.warn } = {}) {
  const v = String(env.PAGE_RENDERER ?? '').trim().toLowerCase().replace(/_/g, '-')
  if (!v || v === 'openai') return 'openai'
  if (v === 'hybrid' || v === 'hybrid-only') return v
  warn(`Unknown PAGE_RENDERER "${v}" — using openai`)
  return 'openai'
}

/** PAGE_RENDERER=hybrid or hybrid-only: worksheet/activity pages go to the hybrid layout engine. */
export const isHybridRenderer = (env = process.env) => pageRenderer(env, { warn: () => {} }) !== 'openai'

/** PAGE_RENDERER=hybrid-only: nothing in the run may call OpenAI. */
export const isHybridOnly = (env = process.env) => pageRenderer(env, { warn: () => {} }) === 'hybrid-only'
