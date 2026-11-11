import { describe, it, expect, vi } from 'vitest'
import { isMarketCheckEnabled, buildMarketCheckPrompt, parseMarketDecision, marketCheck } from '../src/steps/market-check.js'

describe('isMarketCheckEnabled', () => {
  it('is on by default', () => expect(isMarketCheckEnabled({})).toBe(true))
  it('is off when MARKET_CHECK=off', () => expect(isMarketCheckEnabled({ MARKET_CHECK: 'off' })).toBe(false))
  it('is bypassed by FORCE_GENERATE=true', () => expect(isMarketCheckEnabled({ FORCE_GENERATE: 'true' })).toBe(false))
  it('ignores FORCE_GENERATE=false (scheduled runs)', () => expect(isMarketCheckEnabled({ FORCE_GENERATE: 'false' })).toBe(true))
  it('treats an empty MARKET_CHECK variable as on', () => expect(isMarketCheckEnabled({ MARKET_CHECK: '' })).toBe(true))
})

describe('buildMarketCheckPrompt', () => {
  it('includes date, tier and recent titles', () => {
    const p = buildMarketCheckPrompt({
      date: '2026-11-11', packageType: 'small',
      history: [{ date: '2026-11-10', setTitle: 'Fall Fractions', subject: 'Math', gradeLevel: '3rd' }],
    })
    expect(p).toContain('2026-11-11')
    expect(p).toContain('small tier')
    expect(p).toContain('Fall Fractions')
  })
  it('handles empty history', () => {
    expect(buildMarketCheckPrompt({ date: 'd', packageType: 'free', history: [] })).toContain('(none yet)')
  })
})

describe('parseMarketDecision', () => {
  it('parses a valid answer and caps evidence at 3', () => {
    const d = parseMarketDecision(JSON.stringify({ generate: false, reason: ' Break. ', evidence: ['a', 'b', 'c', 'd'] }))
    expect(d).toEqual({ generate: false, reason: 'Break.', evidence: ['a', 'b', 'c'] })
  })
  it('strips citation markers and surrounding prose/fences', () => {
    const d = parseMarketDecision('```json\n{"generate":true,"reason":"Peak season【3†L12-L16】","evidence":["a【4†L1-L2】"]}\n```')
    expect(d).toEqual({ generate: true, reason: 'Peak season', evidence: ['a'] })
  })
  it('throws when generate is not a boolean', () => {
    expect(() => parseMarketDecision('{"generate":"no"}')).toThrow()
  })
  it('throws on invalid JSON', () => {
    expect(() => parseMarketDecision('not json')).toThrow()
  })
})

describe('marketCheck', () => {
  const ctx = { date: '2026-11-11', packageType: 'small', history: [] }
  const clientReturning = (content) => ({
    chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) } },
  })

  it('returns the model decision when it says skip', async () => {
    const client = clientReturning('{"generate":false,"reason":"Holiday lull","evidence":["x"]}')
    const d = await marketCheck(ctx, { client })
    expect(d).toMatchObject({ generate: false, reason: 'Holiday lull', checked: true })
    expect(client.chat.completions.create.mock.calls[0][0].tools).toEqual([{ type: 'browser_search' }])
  })

  it('fails open when the answer is unparseable', async () => {
    const d = await marketCheck(ctx, { client: clientReturning('garbage') })
    expect(d.generate).toBe(true)
    expect(d.checked).toBe(false)
  })

  it('fails open when the API throws', async () => {
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 })) } } }
    const d = await marketCheck(ctx, { client })
    expect(d).toMatchObject({ generate: true, checked: false })
  })
})
