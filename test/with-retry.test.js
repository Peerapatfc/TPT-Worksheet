import { describe, it, expect, vi } from 'vitest'
import { withRetry, isQuotaExhausted } from '../src/llm/with-retry.js'

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
