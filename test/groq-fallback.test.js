import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withGeminiFallback, isGeminiFallbackEnabled, canReplayOnGemini, toGeminiRequest, GEMINI_MAX_TOKENS } from '../src/llm/groq-fallback.js'
import { callTool } from '../src/llm/tool-call.js'
import { costSummary, resetUsage } from '../src/lib/cost-tracker.js'
import { MODELS, PRICING } from '../src/config/constants.js'

const err = (status, message) => Object.assign(new Error(message), { status })
const DAILY = () => err(429, 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199900')
const TPM = () => err(429, 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000')

const ok = (tag) => ({ tag, choices: [{ message: { tool_calls: [{ function: { name: 'f', arguments: '{"a":1}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
const fnTool = { type: 'function', function: { name: 'f', parameters: { type: 'object' } } }
const body = (extra = {}) => ({ model: MODELS.content, max_tokens: 1000, tools: [fnTool], tool_choice: { type: 'function', function: { name: 'f' } }, messages: [{ role: 'user', content: 'hi' }], ...extra })

function setup(groqImpl, geminiImpl = async () => ok('gemini')) {
  const groqCreate = vi.fn(groqImpl)
  const geminiCreate = vi.fn(geminiImpl)
  const warn = vi.fn()
  const client = withGeminiFallback({
    groqClient: { chat: { completions: { create: groqCreate } } },
    getGeminiClient: () => ({ chat: { completions: { create: geminiCreate } } }),
    sleep: async () => {},
    warn,
  })
  return { client, groqCreate, geminiCreate, warn }
}

describe('isGeminiFallbackEnabled', () => {
  it('needs both GROQ_FALLBACK=gemini and GEMINI_API_KEY', () => {
    expect(isGeminiFallbackEnabled({})).toBe(false)
    expect(isGeminiFallbackEnabled({ GROQ_FALLBACK: 'gemini' })).toBe(false)
    expect(isGeminiFallbackEnabled({ GEMINI_API_KEY: 'k' })).toBe(false)
    expect(isGeminiFallbackEnabled({ GROQ_FALLBACK: 'off', GEMINI_API_KEY: 'k' })).toBe(false)
    expect(isGeminiFallbackEnabled({ GROQ_FALLBACK: ' Gemini ', GEMINI_API_KEY: 'k' })).toBe(true)
  })
})

describe('withGeminiFallback', () => {
  it('passes Groq results through untouched', async () => {
    const { client, geminiCreate } = setup(async () => ok('groq'))
    const res = await client.chat.completions.create(body())
    expect(res.tag).toBe('groq')
    expect(res.servedBy).toBeUndefined()
    expect(geminiCreate).not.toHaveBeenCalled()
  })

  it('does not fall back on a per-minute 429 or a 400', async () => {
    for (const e of [TPM(), err(400, 'bad request'), err(500, 'boom')]) {
      const { client, geminiCreate } = setup(async () => { throw e })
      await expect(client.chat.completions.create(body())).rejects.toBe(e)
      expect(geminiCreate).not.toHaveBeenCalled()
    }
  })

  it('replays the request on Gemini after a daily 429 and warns once', async () => {
    const { client, geminiCreate, warn } = setup(async () => { throw DAILY() })
    const res = await client.chat.completions.create(body({ reasoning_effort: 'low' }))
    expect(res.tag).toBe('gemini')
    expect(res.servedBy).toBe(MODELS.groqFallbackGemini)
    const sent = geminiCreate.mock.calls[0][0]
    expect(sent.model).toBe(MODELS.groqFallbackGemini)
    expect(sent).not.toHaveProperty('reasoning_effort')
    expect(sent.tools).toEqual([fnTool])
    expect(geminiCreate.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    await client.chat.completions.create(body())
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('is sticky: after the daily 429 later calls skip Groq', async () => {
    const { client, groqCreate, geminiCreate } = setup(async () => { throw DAILY() })
    await client.chat.completions.create(body())
    await client.chat.completions.create(body())
    await client.chat.completions.create(body())
    expect(groqCreate).toHaveBeenCalledTimes(1)
    expect(geminiCreate).toHaveBeenCalledTimes(3)
  })

  it('never replays a browser_search request (fail-open stays with the caller)', async () => {
    const daily = DAILY()
    const { client, geminiCreate } = setup(async () => { throw daily })
    const search = body({ tools: [{ type: 'browser_search' }], tool_choice: undefined })
    await expect(client.chat.completions.create(search)).rejects.toBe(daily)
    expect(geminiCreate).not.toHaveBeenCalled()
    // ...and is still sent to Groq even once the fallback is sticky.
    await client.chat.completions.create(body())
    await expect(client.chat.completions.create(search)).rejects.toBe(daily)
    expect(geminiCreate).toHaveBeenCalledTimes(1)
  })

  it('retries Gemini up to 2 times on 503/429, then throws a status-less error', async () => {
    const { client, geminiCreate } = setup(async () => { throw DAILY() }, async () => { throw err(503, 'high demand') })
    const p = client.chat.completions.create(body())
    await expect(p).rejects.toThrow(/Gemini fallback .* failed: 503/)
    await p.catch(e => expect(e.status).toBeUndefined())
    expect(geminiCreate).toHaveBeenCalledTimes(3)
  })

  it('recovers when a Gemini retry succeeds, and does not retry a Gemini 400', async () => {
    let n = 0
    const a = setup(async () => { throw DAILY() }, async () => { if (n++ === 0) throw err(503, 'x'); return ok('gemini') })
    expect((await a.client.chat.completions.create(body())).tag).toBe('gemini')
    expect(a.geminiCreate).toHaveBeenCalledTimes(2)
    const b = setup(async () => { throw DAILY() }, async () => { throw err(400, 'bad') })
    await expect(b.client.chat.completions.create(body())).rejects.toThrow(/400/)
    expect(b.geminiCreate).toHaveBeenCalledTimes(1)
  })
})

describe('request translation', () => {
  it('drops Groq-only params and message reasoning, caps max_tokens', () => {
    const out = toGeminiRequest({
      model: 'openai/gpt-oss-120b', max_tokens: 64000, reasoning_effort: 'low', reasoning_format: 'hidden', include_reasoning: false,
      messages: [{ role: 'assistant', content: null, reasoning: 'secret', tool_calls: [] }],
    })
    expect(out.model).toBe(MODELS.groqFallbackGemini)
    expect(out.max_tokens).toBe(GEMINI_MAX_TOKENS)
    for (const k of ['reasoning_effort', 'reasoning_format', 'include_reasoning']) expect(out).not.toHaveProperty(k)
    expect(out.messages[0]).toEqual({ role: 'assistant', content: null, tool_calls: [] })
    expect(toGeminiRequest({ max_tokens: 500 }).max_tokens).toBe(500)
  })

  it('canReplayOnGemini rejects built-in tools', () => {
    expect(canReplayOnGemini({ tools: [fnTool] })).toBe(true)
    expect(canReplayOnGemini({})).toBe(true)
    expect(canReplayOnGemini({ tools: [{ type: 'browser_search' }] })).toBe(false)
  })
})

describe('cost tracking', () => {
  beforeEach(() => resetUsage())

  it('records usage under the Gemini model at $0', async () => {
    const { client } = setup(async () => { throw DAILY() })
    await callTool(client, { model: MODELS.content, messages: [], tool: fnTool, step: 'content' })
    const { byStep, totalUsd, unpricedModels } = costSummary()
    expect(byStep).toEqual([expect.objectContaining({ step: 'content', model: MODELS.groqFallbackGemini, inputTokens: 10, usd: 0 })])
    expect(totalUsd).toBe(0)
    expect(unpricedModels).toBeUndefined()
    expect(PRICING[MODELS.groqFallbackGemini]).toEqual({ input: 0, output: 0 })
  })

  it('does not crash when Gemini returns no usage', async () => {
    const { client } = setup(async () => { throw DAILY() }, async () => ({ choices: [{ message: {} }] }))
    await callTool(client, { model: MODELS.content, messages: [], tool: fnTool, step: 'content' })
    expect(costSummary().byStep[0]).toMatchObject({ model: MODELS.groqFallbackGemini, callsWithoutUsage: 1 })
  })
})

describe('groq() client selection', () => {
  async function freshGroq(env) {
    vi.resetModules()
    const saved = { GROQ_FALLBACK: process.env.GROQ_FALLBACK, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GROQ_API_KEY: process.env.GROQ_API_KEY }
    delete process.env.GROQ_FALLBACK
    delete process.env.GEMINI_API_KEY
    Object.assign(process.env, { GROQ_API_KEY: 'test' }, env)
    try {
      const { groq } = await import('../src/llm/clients.js')
      return groq()
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
    }
  }

  it('returns the plain OpenAI client when the flag is off or the key is missing', async () => {
    for (const env of [{}, { GROQ_FALLBACK: 'gemini' }, { GEMINI_API_KEY: 'k' }]) {
      const c = await freshGroq(env)
      expect(Object.getPrototypeOf(c).constructor.name).toBe('OpenAI')
      expect(Object.hasOwn(c.chat.completions, 'create')).toBe(false)
    }
  })

  it('wraps the client when GROQ_FALLBACK=gemini and GEMINI_API_KEY are set', async () => {
    const c = await freshGroq({ GROQ_FALLBACK: 'gemini', GEMINI_API_KEY: 'k' })
    expect(Object.hasOwn(c.chat.completions, 'create')).toBe(true)
  })
})
