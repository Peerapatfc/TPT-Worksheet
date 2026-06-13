import { RETRY } from '../config/constants.js'

/**
 * Retry an async API call with exponential backoff on transient errors.
 * Only 429 (rate limit), 500, and 503 are retried; everything else throws immediately.
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
      const retryable = err.status === 429 || err.status === 503 || err.status === 500
      if (!retryable || attempt === maxAttempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`${label} ${err.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
