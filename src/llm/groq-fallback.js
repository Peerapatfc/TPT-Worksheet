import { MODELS } from '../config/constants.js'
import { isDailyLimitExhausted, retryDelayMs } from './with-retry.js'

/**
 * Opt-in Gemini fallback for Groq chat-completions calls.
 *
 * Active only when GROQ_FALLBACK=gemini and GEMINI_API_KEY is set. When a Groq call
 * fails with the DAILY (TPD/RPD) 429, the same request is replayed on Gemini's
 * OpenAI-compatible endpoint (MODELS.groqFallbackGemini), and every later call from
 * the same client goes straight to Gemini. Per-minute 429s, 400s and every other
 * error are left to the caller (withRetry) as before. Requests that use a Groq
 * built-in tool (e.g. market-check's `browser_search`) are never replayed.
 */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
export const GEMINI_TIMEOUT_MS = 60_000
export const GEMINI_MAX_RETRIES = 2
export const GEMINI_MAX_TOKENS = 16_000
const GEMINI_RETRY_BASE_MS = 2_000

/** Request params Groq accepts but Gemini's OpenAI endpoint does not. */
const GROQ_ONLY_PARAMS = ['reasoning_effort', 'reasoning_format', 'include_reasoning', 'service_tier', 'compound_custom', 'search_settings', 'documents', 'citation_options']

/** True when the opt-in flag and the key are both present. */
export function isGeminiFallbackEnabled(env = process.env) {
  return (env.GROQ_FALLBACK ?? '').trim().toLowerCase() === 'gemini' && Boolean((env.GEMINI_API_KEY ?? '').trim())
}

/** False for requests carrying a non-function (provider built-in) tool, e.g. browser_search. */
export function canReplayOnGemini(body) {
  return !(body?.tools ?? []).some(t => t?.type !== 'function')
}

/** Groq request → Gemini request: swap model, drop Groq-only params and message fields, cap max_tokens. */
export function toGeminiRequest(body, model = MODELS.groqFallbackGemini) {
  const out = { ...body, model }
  for (const p of GROQ_ONLY_PARAMS) delete out[p]
  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map(m => {
      if (!m || typeof m !== 'object' || !('reasoning' in m)) return m
      const { reasoning, ...rest } = m
      return rest
    })
  }
  for (const k of ['max_tokens', 'max_completion_tokens']) {
    if (typeof out[k] === 'number') out[k] = Math.min(out[k], GEMINI_MAX_TOKENS)
  }
  return out
}

function isRetryableGeminiError(err) {
  if (err?.status === 503 || err?.status === 429 || err?.status === 500) return true
  // Our AbortSignal timeout (or the SDK's own timeout) — Gemini sometimes hangs on "high demand".
  return /Abort|Timeout/.test(`${err?.name ?? ''} ${err?.constructor?.name ?? ''}`)
}

/**
 * Wrap a Groq OpenAI-compatible client so chat.completions.create can fall back to Gemini.
 *
 * @param {{
 *   groqClient: object,
 *   getGeminiClient: () => object,
 *   model?: string,
 *   timeoutMs?: number,
 *   maxRetries?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   warn?: (msg: string) => void,
 * }} deps
 */
export function withGeminiFallback({
  groqClient,
  getGeminiClient,
  model = MODELS.groqFallbackGemini,
  timeoutMs = GEMINI_TIMEOUT_MS,
  maxRetries = GEMINI_MAX_RETRIES,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  warn = console.warn,
}) {
  let dailyLimitHit = false

  async function callGemini(body, options) {
    const request = toGeminiRequest(body, model)
    const gemini = getGeminiClient()
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await gemini.chat.completions.create(request, { ...options, signal: AbortSignal.timeout(timeoutMs) })
        // Lets call sites record cost under the model that actually answered.
        if (result && typeof result === 'object') Object.defineProperty(result, 'servedBy', { value: model, enumerable: false })
        return result
      } catch (err) {
        if (!isRetryableGeminiError(err) || attempt > maxRetries) {
          // Drop the HTTP status so the outer withRetry does not multiply Gemini attempts.
          const wrapped = new Error(`Gemini fallback (${model}) failed: ${err?.status ?? err?.name ?? 'error'} ${err?.message ?? ''}`.trim())
          wrapped.cause = err
          throw wrapped
        }
        const delay = retryDelayMs(err, attempt, { baseMs: GEMINI_RETRY_BASE_MS }) + Math.round(Math.random() * 1000)
        warn(`Gemini fallback ${err?.status ?? err?.name} on attempt ${attempt}/${maxRetries + 1} — retrying in ${delay}ms`)
        await sleep(delay)
      }
    }
  }

  async function create(body, options) {
    const replayable = canReplayOnGemini(body)
    if (dailyLimitHit && replayable) return callGemini(body, options)
    try {
      return await groqClient.chat.completions.create(body, options)
    } catch (err) {
      if (!replayable || !isDailyLimitExhausted(err)) throw err
      if (!dailyLimitHit) {
        dailyLimitHit = true
        warn(`Groq daily limit (TPD/RPD) reached — falling back to Gemini ${model} for the rest of this run`)
      }
      return callGemini(body, options)
    }
  }

  const wrapped = Object.create(groqClient)
  wrapped.chat = Object.create(groqClient.chat ?? null)
  wrapped.chat.completions = Object.create(groqClient.chat?.completions ?? null)
  wrapped.chat.completions.create = create
  return wrapped
}
