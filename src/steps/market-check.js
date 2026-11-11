import { groq } from '../llm/clients.js'
import { withRetry } from '../llm/with-retry.js'
import { recordUsage } from '../lib/cost-tracker.js'
import { MODELS } from '../config/constants.js'

/**
 * Should the pipeline run at all today? Off only when MARKET_CHECK is "off"/"false"/"0",
 * or when FORCE_GENERATE is truthy (manual workflow_dispatch override).
 * Pure — exported for unit testing.
 */
export function isMarketCheckEnabled(env = process.env) {
  const off = /^(off|false|0)$/i.test((env.MARKET_CHECK ?? '').trim())
  const force = /^(1|true|yes|on)$/i.test((env.FORCE_GENERATE ?? '').trim())
  return !off && !force
}

/** Prompt for the market check. Pure — exported for unit testing. */
export function buildMarketCheckPrompt({ date, packageType, history }) {
  const recent = history.slice(0, 14)
    .map(h => `- ${h.date}: ${h.setTitle} (${h.subject ?? 'n/a'}, ${h.gradeLevel ?? 'n/a'})`)
    .join('\n') || '- (none yet)'
  return [
    `Today is ${date}. We sell printable K-6 worksheet sets on Teachers Pay Teachers (TPT) and publish at most one new set per day (${packageType} tier today).`,
    'Use web search to check the current TPT / US-teacher market, then decide whether publishing a NEW set today is worthwhile.',
    '',
    'Look at: seasonal demand and the US school calendar right now (back-to-school, holidays, testing season, summer break), what is trending or in demand on TPT, and whether our recent releases already saturate the likely topics.',
    '',
    'Our most recent sets:',
    recent,
    '',
    'Answer generate=false ONLY if you find concrete evidence that a new set today would sell poorly (for example: teachers are on a long break with sharply lower demand, or we just released several near-identical sets). If evidence is weak, mixed or missing, answer generate=true.',
    'Reply with ONLY a JSON object, no prose and no code fences: {"generate": boolean, "reason": string, "evidence": string[]}.',
    'Keep "reason" to one or two sentences. "evidence" lists up to 3 short facts or source URLs.',
  ].join('\n')
}

/**
 * Parse the model's JSON answer. Anything malformed throws, so the caller can
 * fail open. Pure — exported for unit testing.
 * @returns {{ generate: boolean, reason: string, evidence: string[] }}
 */
export function parseMarketDecision(text) {
  // Groq's browser tool leaves citation markers like 【3†L12-L16】 in the text; the model may also wrap JSON in prose/fences.
  const clean = String(text ?? '').replace(/【[^】]*】/g, '')
  const json = clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)
  const data = JSON.parse(json)
  if (typeof data?.generate !== 'boolean') throw new Error('market decision missing boolean "generate"')
  return {
    generate: data.generate,
    reason: typeof data.reason === 'string' ? data.reason.trim() : '',
    evidence: Array.isArray(data.evidence) ? data.evidence.filter(e => typeof e === 'string').map(e => e.trim()).slice(0, 3) : [],
  }
}

/**
 * Ask Groq gpt-oss-120b (built-in browser_search tool, free-tier friendly) whether to generate today.
 * Fail-open: a failed search, API error or unparseable answer returns
 * `{ generate: true, checked: false }` so a flaky check never blocks the daily run.
 *
 * @param {{ date: string, packageType: string, history: Array<object> }} ctx
 * @param {{ client?: object }} [deps] injectable client for tests
 * @returns {Promise<{ generate: boolean, reason: string, evidence: string[], checked: boolean }>}
 */
export async function marketCheck(ctx, { client = groq() } = {}) {
  try {
    const response = await withRetry(
      () => client.chat.completions.create({
        model: MODELS.marketCheck,
        tools: [{ type: 'browser_search' }],
        tool_choice: 'required',
        messages: [{ role: 'user', content: buildMarketCheckPrompt(ctx) }],
      }),
      { label: 'Market check' },
    )
    recordUsage('market_check', MODELS.marketCheck, response.usage)
    return { ...parseMarketDecision(response.choices[0].message.content), checked: true }
  } catch (err) {
    return { generate: true, reason: `market check failed (${err.message}) — generating anyway`, evidence: [], checked: false }
  }
}
