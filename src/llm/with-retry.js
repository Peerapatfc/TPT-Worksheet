import { RETRY } from '../config/constants.js'

/**
 * True for a 429 that is a billing failure (out of credits / quota), not a rate
 * limit — retrying can never succeed, so it must fail fast. OpenAI marks these
 * with code/type `insufficient_quota`; the message check is a fallback.
 */
export function isQuotaExhausted(err) {
  return err?.status === 429 && (
    err.code === 'insufficient_quota' ||
    err.type === 'insufficient_quota' ||
    /no credits remaining|exceeded your current quota/i.test(err.message ?? '')
  )
}

/**
 * Retry an async API call with exponential backoff on transient errors.
 * Only 429 (rate limit), 500, and 503 are retried; everything else — including a
 * 429 for exhausted credits/quota — throws immediately.
 *
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, { maxAttempts = RETRY.maxAttempts, baseDelayMs = RETRY.baseDelayMs, label = 'API' } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = (err.status === 429 && !isQuotaExhausted(err)) || err.status === 503 || err.status === 500
      if (!retryable || attempt === maxAttempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`${label} ${err.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
