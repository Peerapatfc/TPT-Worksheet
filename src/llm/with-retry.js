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
 * True for a 429 from a DAILY limit — Groq's "on tokens per day (TPD)" or "on requests
 * per day (RPD)". The window is rolling over a day, so waiting ≤60s ×3 cannot help and
 * only delays the run; it must fail fast. Per-minute limits (TPM/RPM) stay retryable.
 */
export function isDailyLimitExhausted(err) {
  return err?.status === 429 && /\b(tokens|requests) per day\b|\((TPD|RPD)\)/i.test(err.message ?? '')
}

/** Upper bound for any wait, so a pathological header cannot hang CI. */
export const MAX_RETRY_DELAY_MS = 60_000
const JITTER_MS = 500

function headerValue(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const key = Object.keys(headers).find(k => k.toLowerCase() === name)
  return key === undefined ? undefined : headers[key]
}

/** "1m5.2s", "250ms", "7.66s", "2h3m", bare "12" (seconds) -> ms, or null. */
function parseDurationMs(value) {
  const str = String(value ?? '').trim()
  if (!str) return null
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str) * 1000
  const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gy
  let total = 0
  let pos = 0
  let m
  while ((m = re.exec(str)) !== null) {
    total += parseFloat(m[1]) * units[m[2]]
    pos = re.lastIndex
  }
  return pos === str.length && pos > 0 ? total : null
}

/** Server wait hint in ms from retry-after (seconds or HTTP-date) or x-ratelimit-reset-*; null if none. */
function serverHintMs(err, now) {
  const ra = headerValue(err?.headers, 'retry-after')
  if (ra !== undefined && ra !== null && String(ra).trim() !== '') {
    const secs = Number(ra)
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000
    const date = Date.parse(ra)
    if (!Number.isNaN(date)) return Math.max(0, date - now)
  }
  const resets = ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']
    .map(h => parseDurationMs(headerValue(err?.headers, h)))
    .filter(v => v !== null)
  return resets.length ? Math.max(...resets) : null
}

/**
 * How long to wait before the next attempt. Honors the server's hint (retry-after, else
 * the larger x-ratelimit-reset-* value) plus 0-500ms jitter, clamped to maxMs; without a
 * hint it is the exponential schedule baseMs * 2^(attempt-1), unchanged.
 *
 * @param {{ headers?: object }} err
 * @param {number} attempt 1-based attempt that just failed
 * @param {{ baseMs?: number, maxMs?: number, now?: number, random?: () => number }} [opts]
 */
export function retryDelayMs(err, attempt, { baseMs = RETRY.baseDelayMs, maxMs = MAX_RETRY_DELAY_MS, now = Date.now(), random = Math.random } = {}) {
  const hint = serverHintMs(err, now)
  if (hint === null) return baseMs * 2 ** (attempt - 1)
  return Math.min(Math.round(hint + random() * JITTER_MS), maxMs)
}

/**
 * Retry an async API call with exponential backoff on transient errors.
 * Only 429 (rate limit), 500, and 503 are retried; everything else — including a
 * 429 for exhausted credits/quota or a daily (TPD/RPD) limit — throws immediately.
 *
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, label?: string, sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, { maxAttempts = RETRY.maxAttempts, baseDelayMs = RETRY.baseDelayMs, label = 'API', sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isDailyLimitExhausted(err)) {
        console.warn(`${label} 429: daily rate limit (TPD/RPD) reached — not retrying`)
        throw err
      }
      const retryable = (err.status === 429 && !isQuotaExhausted(err)) || err.status === 503 || err.status === 500
      if (!retryable || attempt === maxAttempts) throw err
      const delay = retryDelayMs(err, attempt, { baseMs: baseDelayMs })
      console.warn(`${label} ${err.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
}
