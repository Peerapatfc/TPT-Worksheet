// Centralized configuration constants — single source of truth for models,
// page-count ranges, retry policy, and layout dimensions.

/**
 * Models used at each pipeline step.
 * NOTE: content generation runs on Groq (Llama), not OpenAI — see src/llm/clients.js.
 */
export const MODELS = {
  brainstorm: 'gpt-4o', // OpenAI
  content: 'openai/gpt-oss-120b', // Groq (llama-3.3-70b-versatile was retired 2026-08-16)
  validate: 'gpt-4o-mini', // OpenAI vision
  reconcile: 'gpt-4o-mini', // OpenAI vision
  image: 'gpt-image-2', // OpenAI images
}

/**
 * Total-page ranges per package tier. `max: null` means "bounded by MAX_PAGES_PER_SET".
 * Structure per set: 1 cover + N worksheet/activity pages + ceil(N/2) answer keys.
 */
export const PAGE_RANGES = {
  free: { min: 7, max: 10 },
  small: { min: 15, max: 20 },
  large: { min: 21, max: null },
}

/** Exponential-backoff retry policy for transient API errors (429/500/503). */
export const RETRY = { maxAttempts: 4, baseDelayMs: 2000 }

/** A4 page size in PDF points (72 dpi). */
export const A4 = { width: 595.28, height: 841.89 }

/** gpt-image-2 output sizes. Portrait is closer to A4; square is used for covers/slides. */
export const IMAGE_SIZE = {
  cover: '1024x1024',
  page: '1024x1536',
  slide: '1024x1024',
}

/**
 * USD per 1M tokens, used only for cost-log estimates (token counts are exact;
 * dollars are as good as this table). Verify against the providers' pricing
 * pages and update when they change — gpt-image-2 figures were taken from
 * third-party trackers (Oct 2026); gpt-oss-120b is Groq's launch price (some
 * trackers list $0.60 output).
 * A model missing here is logged with tokens but `usd: null`.
 */
export const PRICING = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-image-2': { input: 5, output: 30 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.75 },
}
