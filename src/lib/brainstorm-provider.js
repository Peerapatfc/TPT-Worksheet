import { openai, groq } from '../llm/clients.js'
import { MODELS } from '../config/constants.js'
import { isHybridOnly } from '../config/renderer.js'

/**
 * Which LLM runs the brainstorm step, from env BRAINSTORM_PROVIDER:
 * `openai` (default / unset) → gpt-4o, `groq` → openai/gpt-oss-120b (free tier).
 * Unknown values fall back to openai with a warning. With PAGE_RENDERER=hybrid-only
 * (zero-OpenAI run) brainstorm is always Groq; an explicit non-groq value only warns.
 *
 * gpt-oss is a reasoning model and its reasoning tokens count toward max_tokens,
 * so the Groq budget is larger than gpt-4o's 4000 (a plan alone is ~2–4k tokens).
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{ warn?: (msg: string) => void }} [deps]
 * @returns {{ provider: 'openai'|'groq', model: string, maxTokens: number, label: string, getClient: () => object }}
 */
export function resolveBrainstormProvider(env = process.env, { warn = console.warn } = {}) {
  const raw = (env.BRAINSTORM_PROVIDER ?? '').trim().toLowerCase()
  const groqProvider = { provider: 'groq', model: MODELS.brainstormGroq, maxTokens: 16000, label: 'Groq brainstorm', getClient: groq }
  if (raw === 'groq') return groqProvider
  if (isHybridOnly(env)) {
    if (raw !== '') warn(`BRAINSTORM_PROVIDER="${raw}" ignored: PAGE_RENDERER=hybrid-only never calls OpenAI — using groq`)
    return groqProvider
  }
  if (raw !== '' && raw !== 'openai') {
    warn(`BRAINSTORM_PROVIDER="${raw}" is not openai|groq — using openai`)
  }
  return { provider: 'openai', model: MODELS.brainstorm, maxTokens: 4000, label: 'OpenAI brainstorm', getClient: openai }
}
