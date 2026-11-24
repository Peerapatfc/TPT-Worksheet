import { describe, it, expect, vi, beforeAll } from 'vitest'
import {
  isMarketCheckEnabled, resolveMarketCheckMode, buildMarketCheckPrompt, buildLightMarketCheckPrompt,
  buildMarketCheckRequest, hasRecentSaturation, parseMarketDecision, marketCheck, LIGHT_MAX_TOKENS,
} from '../src/steps/market-check.js'

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

describe('resolveMarketCheckMode', () => {
  const monday = new Date('2026-11-23T00:05:00Z')
  const tuesday = new Date('2026-11-24T00:05:00Z')
  const sunday = new Date('2026-11-22T00:05:00Z')
  const resolve = (env, date = tuesday) => {
    const warn = vi.fn()
    return { mode: resolveMarketCheckMode(env, { date, warn }), warn }
  }

  it('defaults (unset/empty/auto) to search on Monday and light otherwise', () => {
    for (const env of [{}, { MARKET_CHECK: '' }, { MARKET_CHECK: ' auto ' }, { MARKET_CHECK: 'AUTO' }]) {
      expect(resolve(env, monday).mode).toBe('search')
      expect(resolve(env, tuesday).mode).toBe('light')
      expect(resolve(env, sunday).mode).toBe('light')
    }
  })
  it('honours MARKET_CHECK_SEARCH_DAY in auto mode (UTC weekday)', () => {
    expect(resolve({ MARKET_CHECK_SEARCH_DAY: '0' }, sunday).mode).toBe('search')
    expect(resolve({ MARKET_CHECK_SEARCH_DAY: '0' }, monday).mode).toBe('light')
    expect(resolve({ MARKET_CHECK_SEARCH_DAY: '2' }, tuesday).mode).toBe('search')
    // 23:30 UTC Monday is still Monday in UTC even if local time differs
    expect(resolve({}, new Date('2026-11-23T23:30:00Z')).mode).toBe('search')
  })
  it('warns and uses Monday for an invalid MARKET_CHECK_SEARCH_DAY', () => {
    const r = resolve({ MARKET_CHECK_SEARCH_DAY: '9' }, monday)
    expect(r.mode).toBe('search')
    expect(r.warn).toHaveBeenCalledOnce()
  })
  it('explicit search / light run every day', () => {
    expect(resolve({ MARKET_CHECK: 'search' }, tuesday).mode).toBe('search')
    expect(resolve({ MARKET_CHECK: 'Light' }, monday).mode).toBe('light')
  })
  it('off / false / 0 and FORCE_GENERATE stay off', () => {
    for (const v of ['off', 'false', '0', 'OFF']) expect(resolve({ MARKET_CHECK: v }).mode).toBe('off')
    expect(resolve({ MARKET_CHECK: 'search', FORCE_GENERATE: 'true' }).mode).toBe('off')
    expect(resolve({ FORCE_GENERATE: 'true' }, monday).mode).toBe('off')
    expect(resolve({ FORCE_GENERATE: 'false' }, monday).mode).toBe('search')
  })
  it('warns and falls back to auto for an unknown value', () => {
    const r = resolve({ MARKET_CHECK: 'yes please' }, tuesday)
    expect(r.mode).toBe('light')
    expect(r.warn).toHaveBeenCalledOnce()
    expect(resolve({ MARKET_CHECK: 'bogus' }, monday).mode).toBe('search')
  })
})

describe('buildMarketCheckRequest', () => {
  const ctx = { date: '2026-11-24', packageType: 'small', history: [{ date: '2026-11-23', setTitle: 'Fall Fractions', subject: 'Math', gradeLevel: '3rd' }] }

  it('search mode keeps the exact browser_search request shape', () => {
    const req = buildMarketCheckRequest(ctx, 'search')
    expect(Object.keys(req)).toEqual(['model', 'tools', 'tool_choice', 'messages'])
    expect(req).toEqual({
      model: 'openai/gpt-oss-120b',
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      messages: [{ role: 'user', content: buildMarketCheckPrompt(ctx) }],
    })
    expect(req.messages[0].content).toMatch(/at most 2–3 searches/)
  })

  it('light mode sends no tools, a small max_tokens and the light prompt', () => {
    const req = buildMarketCheckRequest(ctx, 'light')
    expect(req.tools).toBeUndefined()
    expect(req.tool_choice).toBeUndefined()
    expect(req.max_tokens).toBe(LIGHT_MAX_TOKENS)
    expect(req.max_tokens).toBeLessThanOrEqual(2000)
    expect(req.messages).toEqual([{ role: 'user', content: buildLightMarketCheckPrompt(ctx) }])
  })
})

describe('buildLightMarketCheckPrompt', () => {
  it('says no web access, forbids trend/season skips and lists history', () => {
    const p = buildLightMarketCheckPrompt({ date: '2026-11-24', packageType: 'free', history: [{ date: '2026-11-23', setTitle: 'Fall Fractions', subject: 'Math', gradeLevel: '3rd' }] })
    expect(p).toContain('2026-11-24')
    expect(p).toContain('free tier')
    expect(p).toContain('Fall Fractions')
    expect(p).toMatch(/NO web access/)
    expect(p).toMatch(/Never answer generate=false because of trends, seasons, holidays/)
    expect(p.length).toBeLessThan(3000)
  })
})

describe('hasRecentSaturation', () => {
  const h = (date, subject = 'Math', gradeLevel = '3rd') => ({ date, setTitle: 't', subject, gradeLevel })
  it('needs 3+ sets with the same subject and grade in the last 7 days', () => {
    expect(hasRecentSaturation([h('2026-11-23'), h('2026-11-22'), h('2026-11-20')], '2026-11-24')).toBe(true)
    expect(hasRecentSaturation([h('2026-11-23'), h('2026-11-22')], '2026-11-24')).toBe(false)
    expect(hasRecentSaturation([h('2026-11-23'), h('2026-11-22'), h('2026-11-20', 'Science')], '2026-11-24')).toBe(false)
    expect(hasRecentSaturation([h('2026-11-23'), h('2026-11-22'), h('2026-11-10')], '2026-11-24')).toBe(false)
    expect(hasRecentSaturation([], '2026-11-24')).toBe(false)
  })
})

describe('marketCheck modes', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  const saturated = ['2026-11-23', '2026-11-22', '2026-11-21'].map(date => ({ date, setTitle: 'Fractions', subject: 'Math', gradeLevel: '3rd' }))
  const clientReturning = (content, usage = { prompt_tokens: 900, completion_tokens: 120 }) => ({
    chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }], usage }) } },
  })

  it('light mode parses the contract and reports mode + tokens', async () => {
    const client = clientReturning('{"generate":true,"reason":"No saturation","evidence":[]}')
    const d = await marketCheck({ date: '2026-11-24', packageType: 'small', history: [] }, { client, mode: 'light' })
    expect(d).toMatchObject({ generate: true, checked: true, mode: 'light', tokens: { input: 900, output: 120 } })
    expect(client.chat.completions.create).toHaveBeenCalledOnce()
    expect(client.chat.completions.create.mock.calls[0][0].tools).toBeUndefined()
  })

  it('light mode honours a skip backed by saturated history', async () => {
    const client = clientReturning('{"generate":false,"reason":"Three near-identical Math sets","evidence":["Fractions"]}')
    const d = await marketCheck({ date: '2026-11-24', packageType: 'small', history: saturated }, { client, mode: 'light' })
    expect(d).toMatchObject({ generate: false, checked: true, mode: 'light' })
  })

  it('light mode overrides a skip without saturation (no trend-based skips)', async () => {
    const client = clientReturning('{"generate":false,"reason":"Thanksgiving week lull","evidence":[]}')
    const d = await marketCheck({ date: '2026-11-24', packageType: 'small', history: saturated.slice(0, 1) }, { client, mode: 'light' })
    expect(d.generate).toBe(true)
    expect(d.reason).toMatch(/Thanksgiving week lull/)
  })

  it('search mode skip is not subject to the saturation guard', async () => {
    const client = clientReturning('{"generate":false,"reason":"Holiday lull","evidence":["x"]}')
    const d = await marketCheck({ date: '2026-11-24', packageType: 'small', history: [] }, { client, mode: 'search' })
    expect(d).toMatchObject({ generate: false, mode: 'search' })
  })

  it('fails open after one call on a daily-limit 429 (no second paid call)', async () => {
    const err = Object.assign(new Error('Rate limit reached for model `openai/gpt-oss-120b` in organization org_x service tier on_demand on tokens per day (TPD): Limit 200000, Used 199548, Requested 810. Please try again in 2m34.656s.'), { status: 429 })
    const client = { chat: { completions: { create: vi.fn().mockRejectedValue(err) } } }
    for (const mode of ['search', 'light']) {
      client.chat.completions.create.mockClear()
      const d = await marketCheck({ date: '2026-11-24', packageType: 'small', history: [] }, { client, mode })
      expect(d).toMatchObject({ generate: true, checked: false, mode })
      expect(client.chat.completions.create).toHaveBeenCalledOnce()
    }
  })
})
