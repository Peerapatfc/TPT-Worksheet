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

const MODE_VALUES = ['off', 'search', 'light', 'auto']
const DEFAULT_SEARCH_DAY = 1 // Monday (UTC)

/**
 * Which market check runs today: 'off' | 'search' | 'light'.
 * - FORCE_GENERATE truthy or MARKET_CHECK off/false/0 → 'off' (unchanged behaviour).
 * - MARKET_CHECK=search → Groq browser_search every day (59k–289k input tokens per call).
 * - MARKET_CHECK=light → no-tool call judging from date + recent history (~1–2k tokens).
 * - unset/empty/auto (default), or an unknown value (with a warning) → 'search' on
 *   MARKET_CHECK_SEARCH_DAY (0=Sun … 6=Sat, UTC, default 1 = Monday), 'light' otherwise.
 * Pure apart from `warn` — exported for unit testing.
 */
export function resolveMarketCheckMode(env = process.env, { date = new Date(), warn = console.warn } = {}) {
  if (!isMarketCheckEnabled(env)) return 'off'
  let raw = (env.MARKET_CHECK ?? '').trim().toLowerCase()
  if (raw === '') raw = 'auto'
  if (!MODE_VALUES.includes(raw)) {
    warn(`MARKET_CHECK="${env.MARKET_CHECK}" is not off|search|light|auto — using auto`)
    raw = 'auto'
  }
  if (raw !== 'auto') return raw
  const dayRaw = (env.MARKET_CHECK_SEARCH_DAY ?? '').trim()
  let searchDay = DEFAULT_SEARCH_DAY
  if (dayRaw !== '') {
    if (/^[0-6]$/.test(dayRaw)) searchDay = Number(dayRaw)
    else warn(`MARKET_CHECK_SEARCH_DAY="${dayRaw}" is not 0–6 — using ${DEFAULT_SEARCH_DAY}`)
  }
  return date.getUTCDay() === searchDay ? 'search' : 'light'
}

/** Prompt for the market check. Pure — exported for unit testing. */
export function buildMarketCheckPrompt({ date, packageType, history }) {
  const recent = history.slice(0, 14)
    .map(h => `- ${h.date}: ${h.setTitle} (${h.subject ?? 'n/a'}, ${h.gradeLevel ?? 'n/a'})`)
    .join('\n') || '- (none yet)'
  return [
    `Today is ${date}. We sell printable K-6 worksheet sets on Teachers Pay Teachers (TPT) and publish at most one new set per day (${packageType} tier today).`,
    'Use web search to check the current TPT / US-teacher market, then decide whether publishing a NEW set today is worthwhile.',
    'Be brief: run at most 2–3 searches, open only the most relevant results, then answer.',
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

/** Days of history the light check (and its saturation guard) looks at. */
export const LIGHT_WINDOW_DAYS = 7
/** Sets with the same subject + grade inside the window before light mode may skip. */
export const LIGHT_MIN_SIMILAR = 3

/**
 * Prompt for the no-search ("light") check: date, tier and recent history only.
 * Without live data it may skip only for clear saturation, never for trend/season guesses.
 * Pure — exported for unit testing.
 */
export function buildLightMarketCheckPrompt({ date, packageType, history }) {
  const recent = history.slice(0, 14)
    .map(h => `- ${h.date}: ${h.setTitle} (${h.subject ?? 'n/a'}, ${h.gradeLevel ?? 'n/a'})`)
    .join('\n') || '- (none yet)'
  return [
    `Today is ${date}. We sell printable K-6 worksheet sets on Teachers Pay Teachers (TPT) and publish at most one new set per day (${packageType} tier today). Tomorrow's topic is not chosen yet; it will avoid our recent titles.`,
    'You have NO web access. Decide whether publishing a NEW set today is worthwhile using only the date and our recent sets below.',
    '',
    'Our most recent sets:',
    recent,
    '',
    `Answer generate=false ONLY for clear saturation: in the last ${LIGHT_WINDOW_DAYS} days we released ${LIGHT_MIN_SIMILAR} or more sets with the same subject, the same grade and the same topic area, so another one would be near-identical.`,
    'Never answer generate=false because of trends, seasons, holidays, school breaks or guesses about demand — you cannot verify those today. In every other case answer generate=true.',
    'Reply with ONLY a JSON object, no prose and no code fences: {"generate": boolean, "reason": string, "evidence": string[]}.',
    'Keep "reason" to one sentence. "evidence" lists up to 3 of our set titles that justify a skip (empty when generating).',
  ].join('\n')
}

/**
 * Code-side guard for light mode: a skip is only honoured when the history really
 * contains LIGHT_MIN_SIMILAR+ sets with one subject + grade in the last LIGHT_WINDOW_DAYS days.
 * Pure — exported for unit testing.
 */
export function hasRecentSaturation(history, date, { days = LIGHT_WINDOW_DAYS, min = LIGHT_MIN_SIMILAR } = {}) {
  const today = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(today)) return false
  const counts = new Map()
  for (const h of history) {
    const t = Date.parse(`${String(h.date).slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(t) || today - t > days * 86_400_000 || t > today) continue
    if (!h.subject || !h.gradeLevel) continue
    const key = `${h.subject}`.toLowerCase().trim() + '|' + `${h.gradeLevel}`.toLowerCase().trim()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].some(n => n >= min)
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

/** Light mode output cap: gpt-oss reasoning tokens count toward it, so leave headroom. */
export const LIGHT_MAX_TOKENS = 1500

/** Request options per mode. Pure — exported so tests can pin the exact request shape. */
export function buildMarketCheckRequest(ctx, mode) {
  if (mode === 'light') {
    return {
      model: MODELS.marketCheck,
      max_tokens: LIGHT_MAX_TOKENS,
      reasoning_effort: 'low',
      messages: [{ role: 'user', content: buildLightMarketCheckPrompt(ctx) }],
    }
  }
  return {
    model: MODELS.marketCheck,
    tools: [{ type: 'browser_search' }],
    tool_choice: 'required',
    messages: [{ role: 'user', content: buildMarketCheckPrompt(ctx) }],
  }
}

/**
 * Ask Groq gpt-oss-120b whether to generate today. `search` mode uses the built-in
 * browser_search tool (59k–289k input tokens measured); `light` mode sends no tools
 * and judges from date + history only (~1–2k tokens). One call, no fallback call.
 * Fail-open: any API error (incl. a 429, which withRetry throws at once for daily
 * limits) or unparseable answer returns `{ generate: true, checked: false }`.
 *
 * @param {{ date: string, packageType: string, history: Array<object> }} ctx
 * @param {{ client?: object, mode?: 'search'|'light' }} [deps] injectable client for tests
 * @returns {Promise<{ generate: boolean, reason: string, evidence: string[], checked: boolean, mode: string, tokens: { input: number, output: number } }>}
 */
export async function marketCheck(ctx, { client, mode = 'search' } = {}) {
  const tokens = { input: 0, output: 0 }
  try {
    const api = client ?? groq()
    const response = await withRetry(
      () => api.chat.completions.create(buildMarketCheckRequest(ctx, mode)),
      { label: `Market check (${mode})` },
    )
    recordUsage('market_check', MODELS.marketCheck, response.usage)
    tokens.input = response.usage?.prompt_tokens ?? 0
    tokens.output = response.usage?.completion_tokens ?? 0
    console.log(`market_check mode=${mode} tokens=${tokens.input}+${tokens.output}`)
    const decision = parseMarketDecision(response.choices[0].message.content)
    if (mode === 'light' && !decision.generate && !hasRecentSaturation(ctx.history ?? [], ctx.date)) {
      return { generate: true, reason: `light check suggested skipping without clear saturation in history (${decision.reason}) — generating anyway`, evidence: [], checked: true, mode, tokens }
    }
    return { ...decision, checked: true, mode, tokens }
  } catch (err) {
    console.warn(`market_check mode=${mode} failed — generating anyway: ${err.message}`)
    return { generate: true, reason: `market check failed (${err.message}) — generating anyway`, evidence: [], checked: false, mode, tokens }
  }
}
