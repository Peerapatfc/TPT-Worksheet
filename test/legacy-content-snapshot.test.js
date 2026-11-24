// The default content path (PAGE_RENDERER unset/openai) must send Groq exactly the
// requests it sent before the hybrid content step existed: same prompt, tool schema,
// max_tokens and recheck. The stored bodies were captured from origin/master 48f251c
// with the same stubbed fetch (test/fixtures/legacy-content-requests.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import expected from './fixtures/legacy-content-requests.js'

vi.mock('fs', async (orig) => ({ ...(await orig()), writeFileSync: vi.fn(), mkdirSync: vi.fn() }))

const plan = {
  setTitle: 'Autumn Math Adventures', gradeLevel: 'Grade 2', subject: 'Math', packageType: 'small', themeColor: '#E8731C', pageCount: 4,
  pages: [
    { pageNum: 1, type: 'cover', filename: 'cover', imagePrompt: 'Cover' },
    { pageNum: 2, type: 'worksheet', filename: 'add', imagePrompt: 'Addition word problems with pumpkins.' },
    { pageNum: 3, type: 'activity', filename: 'match', imagePrompt: 'A matching activity: numbers to number words.' },
    { pageNum: 4, type: 'answer_key', filename: 'key', imagePrompt: 'key', sourcePageNums: [2, 3] },
  ],
}

function stubGroq() {
  const bodies = []
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    const name = body.tools[0].function.name
    const args = name === 'generate_page_content'
      ? { pages: [{ pageNum: 2, title: 'T', imageSpec: '', questions: [1, 2, 3, 4].map(n => ({ num: n, question: `What is ${n}+1?`, answer: String(n + 1) })) }] }
      : { pass: true, corrections: [] }
    return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 't', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return bodies
}

describe('legacy content path is unchanged', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('GROQ_API_KEY', 'x')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); vi.restoreAllMocks() })

  for (const flag of [undefined, '', 'openai']) {
    it(`PAGE_RENDERER=${JSON.stringify(flag)} sends the stored prompt, schema and recheck byte for byte`, async () => {
      if (flag === undefined) delete process.env.PAGE_RENDERER
      else vi.stubEnv('PAGE_RENDERER', flag)
      const bodies = stubGroq()
      const { generateContent } = await import('../src/steps/generate-content.js')
      await generateContent(structuredClone(plan))
      expect(JSON.stringify(bodies, null, 2)).toBe(JSON.stringify(expected, null, 2))
    })
  }

  it('PAGE_RENDERER=hybrid sends the structured layout tool instead', async () => {
    vi.stubEnv('PAGE_RENDERER', 'hybrid')
    const bodies = stubGroq()
    const { generateContent } = await import('../src/steps/generate-content.js')
    await generateContent(structuredClone(plan)).catch(() => {})
    expect(bodies[0].tools[0].function.name).toBe('generate_layout_content')
    expect(bodies[0].messages[0].content).not.toContain('imageSpec')
  })
})
