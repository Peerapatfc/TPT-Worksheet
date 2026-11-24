import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveBrainstormProvider } from '../src/lib/brainstorm-provider.js'
import { brainstorm } from '../src/steps/brainstorm.js'
import { MODELS } from '../src/config/constants.js'
import { resetUsage, costSummary } from '../src/lib/cost-tracker.js'

describe('resolveBrainstormProvider', () => {
  it('defaults to openai gpt-4o when unset', () => {
    const r = resolveBrainstormProvider({})
    expect(r.provider).toBe('openai')
    expect(r.model).toBe(MODELS.brainstorm)
    expect(r.maxTokens).toBe(4000)
  })

  it('treats an empty value and "openai" as openai without warning', () => {
    const warn = vi.fn()
    expect(resolveBrainstormProvider({ BRAINSTORM_PROVIDER: '' }, { warn }).provider).toBe('openai')
    expect(resolveBrainstormProvider({ BRAINSTORM_PROVIDER: 'OpenAI' }, { warn }).provider).toBe('openai')
    expect(warn).not.toHaveBeenCalled()
  })

  it('selects groq gpt-oss-120b with a larger token budget (reasoning tokens count)', () => {
    const r = resolveBrainstormProvider({ BRAINSTORM_PROVIDER: ' groq ' })
    expect(r.provider).toBe('groq')
    expect(r.model).toBe('openai/gpt-oss-120b')
    expect(r.maxTokens).toBeGreaterThan(4000)
  })

  it('falls back to openai with a warning on an unknown value', () => {
    const warn = vi.fn()
    const r = resolveBrainstormProvider({ BRAINSTORM_PROVIDER: 'anthropic' }, { warn })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe(MODELS.brainstorm)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatch(/anthropic/)
  })
})

// A plan that passes validate() for the small tier: 1 cover + 10 worksheets (+5 keys added in code).
function validPlan(overrides = {}) {
  const pages = [{ pageNum: 1, type: 'cover', filename: 'cover', imagePrompt: 'A cover showing a red apple.' }]
  for (let i = 0; i < 10; i++) {
    pages.push({ pageNum: i + 2, type: 'worksheet', filename: `ws_${i + 1}`, imagePrompt: 'A page with five addition problems.' })
  }
  return {
    setTitle: 'Apple Addition',
    pages,
    tptListing: { title: 'Apple Addition | Grade 1', description: 'Fun set.', subjectAreas: ['Arithmetic'], tags: ['Worksheets', 'Printables'], teachingDuration: '30 minutes', keywords: [] },
    ...overrides,
  }
}

function mockClient(responses) {
  const create = vi.fn()
  for (const plan of responses) {
    create.mockResolvedValueOnce({
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      choices: [{ message: {
        role: 'assistant', content: null, reasoning: 'thinking…',
        tool_calls: [{ id: `call_${create.mock.calls.length}`, type: 'function', function: { name: 'generate_worksheet_plan', arguments: JSON.stringify(plan) } }],
      } }],
    })
  }
  return { client: { chat: { completions: { create } } }, create }
}

describe('brainstorm — provider wiring', () => {
  beforeEach(() => resetUsage())

  it('calls the injected client with the groq model and records usage under it', async () => {
    const { client, create } = mockClient([validPlan()])
    const plan = await brainstorm('Grade 1', 30, [], 'small', 'May', { client, env: { BRAINSTORM_PROVIDER: 'groq' } })
    expect(plan.setTitle).toBe('Apple Addition')
    expect(create).toHaveBeenCalledOnce()
    const req = create.mock.calls[0][0]
    expect(req.model).toBe('openai/gpt-oss-120b')
    expect(req.max_tokens).toBeGreaterThan(4000)
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'generate_worksheet_plan' } })
    expect(JSON.stringify(costSummary())).toContain('openai/gpt-oss-120b')
  })

  it('uses gpt-4o with 4000 tokens by default', async () => {
    const { client, create } = mockClient([validPlan()])
    await brainstorm('Grade 1', 30, [], 'small', 'May', { client, env: {} })
    const req = create.mock.calls[0][0]
    expect(req.model).toBe('gpt-4o')
    expect(req.max_tokens).toBe(4000)
  })

  it('retries after a validation failure without echoing the non-standard reasoning field', async () => {
    const { client, create } = mockClient([validPlan({ setTitle: '' }), validPlan()])
    await brainstorm('Grade 1', 30, [], 'small', 'May', { client, env: { BRAINSTORM_PROVIDER: 'groq' } })
    expect(create).toHaveBeenCalledTimes(2)
    const retryMessages = create.mock.calls[1][0].messages
    const assistant = retryMessages.find(m => m.role === 'assistant')
    expect(assistant).not.toHaveProperty('reasoning')
    expect(assistant.tool_calls).toHaveLength(1)
    expect(retryMessages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringMatching(/Validation failed/) })
  })
})
