import { describe, it, expect, vi } from 'vitest'
import { withRetry, isQuotaExhausted, isDailyLimitExhausted, retryDelayMs, MAX_RETRY_DELAY_MS } from '../src/llm/with-retry.js'

const apiError = (status, extra = {}) => Object.assign(new Error(extra.message ?? `${status}`), { status, ...extra })
const opts = { maxAttempts: 4, baseDelayMs: 0, label: 'test' }

describe('isQuotaExhausted', () => {
  it('detects insufficient_quota by code, type, or message', () => {
    expect(isQuotaExhausted(apiError(429, { code: 'insufficient_quota' }))).toBe(true)
    expect(isQuotaExhausted(apiError(429, { type: 'insufficient_quota' }))).toBe(true)
    expect(isQuotaExhausted(apiError(429, { message: '429 You have no credits remaining. Add credits to continue' }))).toBe(true)
    expect(isQuotaExhausted(apiError(429, { message: 'You exceeded your current quota, please check your plan' }))).toBe(true)
  })

  it('treats a plain rate limit and non-429s as not quota', () => {
    expect(isQuotaExhausted(apiError(429, { code: 'rate_limit_exceeded', message: 'Rate limit reached' }))).toBe(false)
    expect(isQuotaExhausted(apiError(500, { code: 'insufficient_quota' }))).toBe(false)
    expect(isQuotaExhausted(undefined)).toBe(false)
  })
})

describe('withRetry', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('fails fast on exhausted credits without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(429, { code: 'insufficient_quota' }))
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ code: 'insufficient_quota' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still retries an ordinary rate limit and returns on success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(429, { code: 'rate_limit_exceeded' }))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue('ok')
    await expect(withRetry(fn, opts)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after maxAttempts on persistent transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(500))
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ status: 500 })
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(400))
    await expect(withRetry(fn, opts)).rejects.toMatchObject({ status: 400 })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('retryDelayMs', () => {
  const noJitter = { random: () => 0, baseMs: 2000 }
  const hdr = headers => apiError(429, { headers })

  it('falls back to exponential without headers or hints', () => {
    expect(retryDelayMs(apiError(429), 1, noJitter)).toBe(2000)
    expect(retryDelayMs(apiError(503, { headers: {} }), 3, noJitter)).toBe(8000)
    expect(retryDelayMs(hdr(new Headers()), 2, noJitter)).toBe(4000)
  })

  it('honors retry-after seconds (Headers object and plain object, any case)', () => {
    expect(retryDelayMs(hdr(new Headers({ 'retry-after': '32' })), 1, noJitter)).toBe(32000)
    expect(retryDelayMs(hdr({ 'Retry-After': '7.5' }), 1, noJitter)).toBe(7500)
  })

  it('honors an HTTP-date retry-after', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    const err = hdr({ 'retry-after': 'Thu, 01 Jan 2026 00:00:10 GMT' })
    expect(retryDelayMs(err, 1, { ...noJitter, now })).toBe(10000)
    expect(retryDelayMs(hdr({ 'retry-after': 'Wed, 31 Dec 2025 00:00:00 GMT' }), 1, { ...noJitter, now })).toBe(0)
  })

  it('parses Groq duration strings and takes the max', () => {
    expect(retryDelayMs(hdr({ 'x-ratelimit-reset-tokens': '1m5.2s' }), 1, noJitter)).toBe(60000) // 65.2s capped
    expect(retryDelayMs(hdr({ 'x-ratelimit-reset-tokens': '250ms' }), 1, noJitter)).toBe(250)
    expect(retryDelayMs(hdr({ 'x-ratelimit-reset-tokens': '7.66s' }), 1, noJitter)).toBe(7660)
    expect(retryDelayMs(hdr({ 'x-ratelimit-reset-tokens': '7.66s', 'x-ratelimit-reset-requests': '12s' }), 1, noJitter)).toBe(12000)
    expect(retryDelayMs(hdr({ 'x-ratelimit-reset-tokens': '1m5.2s' }), 1, { ...noJitter, maxMs: 120000 })).toBe(65200)
  })

  it('prefers retry-after over reset headers and ignores garbage', () => {
    expect(retryDelayMs(hdr({ 'retry-after': '3', 'x-ratelimit-reset-tokens': '30s' }), 1, noJitter)).toBe(3000)
    expect(retryDelayMs(hdr({ 'retry-after': 'soon', 'x-ratelimit-reset-tokens': 'abc' }), 2, noJitter)).toBe(4000)
  })

  it('adds 0-500ms jitter to a hint only', () => {
    expect(retryDelayMs(hdr({ 'retry-after': '2' }), 1, { random: () => 0.5 })).toBe(2250)
    expect(retryDelayMs(apiError(429), 1, { random: () => 0.99, baseMs: 2000 })).toBe(2000)
  })

  it('caps a pathological hint', () => {
    expect(retryDelayMs(hdr({ 'retry-after': '86400' }), 1, { random: () => 1 })).toBe(MAX_RETRY_DELAY_MS)
    expect(retryDelayMs(hdr({ 'retry-after': '100' }), 1, { random: () => 0, maxMs: 5000 })).toBe(5000)
  })
})

describe('withRetry wait hint', () => {
  it('sleeps for the server hint on a hinted 429 and exponential otherwise', async () => {
    const sleep = vi.fn().mockResolvedValue()
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(429, { headers: new Headers({ 'retry-after': '20' }) }))
      .mockRejectedValueOnce(apiError(500))
      .mockResolvedValue('ok')
    await expect(withRetry(fn, { maxAttempts: 4, baseDelayMs: 2000, label: 'test', sleep })).resolves.toBe('ok')
    const [first, second] = sleep.mock.calls.map(c => c[0])
    expect(first).toBeGreaterThanOrEqual(20000)
    expect(first).toBeLessThanOrEqual(20500)
    expect(second).toBe(4000)
  })

  it('does not sleep or retry a non-retryable status even with a hint', async () => {
    const sleep = vi.fn()
    const fn = vi.fn().mockRejectedValue(apiError(400, { headers: { 'retry-after': '5' } }))
    await expect(withRetry(fn, { ...opts, sleep })).rejects.toMatchObject({ status: 400 })
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('daily rate limits (Groq TPD/RPD)', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const TPD = 'Rate limit reached for model `openai/gpt-oss-120b` in organization org_01abc service tier on_demand on tokens per day (TPD): Limit 200000, Used 199548, Requested 810. Please try again in 2m34.656s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing'
  const RPD = 'Rate limit reached for model `openai/gpt-oss-120b` in organization org_01abc service tier on_demand on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26.4s.'
  const TPM = 'Rate limit reached for model `openai/gpt-oss-120b` in organization org_01abc service tier on_demand on tokens per minute (TPM): Limit 8000, Used 7900, Requested 1200. Please try again in 5.2s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing'

  it('detects TPD / RPD messages only on a 429', () => {
    expect(isDailyLimitExhausted(apiError(429, { message: TPD }))).toBe(true)
    expect(isDailyLimitExhausted(apiError(429, { message: `429 ${RPD}` }))).toBe(true)
    expect(isDailyLimitExhausted(apiError(429, { message: TPM }))).toBe(false)
    expect(isDailyLimitExhausted(apiError(500, { message: TPD }))).toBe(false)
    expect(isDailyLimitExhausted(undefined)).toBe(false)
  })

  it('throws a TPD 429 at once without sleeping', async () => {
    const sleep = vi.fn()
    const fn = vi.fn().mockRejectedValue(apiError(429, { message: TPD, headers: { 'retry-after': '155' } }))
    await expect(withRetry(fn, { ...opts, sleep })).rejects.toThrow(/tokens per day \(TPD\)/)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws an RPD 429 at once', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(429, { message: RPD }))
    await expect(withRetry(fn, { ...opts, sleep: vi.fn() })).rejects.toMatchObject({ status: 429 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('still retries a TPM 429 using its hint', async () => {
    const sleep = vi.fn().mockResolvedValue()
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(429, { message: TPM, headers: { 'retry-after': '6' } }))
      .mockResolvedValue('ok')
    await expect(withRetry(fn, { ...opts, sleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(6000)
  })
})
