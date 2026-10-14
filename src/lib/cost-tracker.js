import { PRICING } from '../config/constants.js'

// In-process accumulator of API token usage, keyed by pipeline step + model.
// Every successful API call records here; the orchestrator logs costSummary()
// once at the end of the run (even if the run fails part-way).
const usageByKey = new Map()

/**
 * Record one API response's token usage. Accepts both the chat-completions shape
 * (prompt_tokens / completion_tokens) and the images shape (input_tokens /
 * output_tokens). A missing `usage` still counts the call, with 0 tokens, and is
 * tallied in `callsWithoutUsage` so an undercounted step is visible in the log.
 */
export function recordUsage(step, model, usage) {
  const key = `${step}|${model}`
  const entry = usageByKey.get(key) ?? { step, model, calls: 0, inputTokens: 0, outputTokens: 0 }
  entry.calls += 1
  if (!usage) entry.callsWithoutUsage = (entry.callsWithoutUsage ?? 0) + 1
  entry.inputTokens += usage?.prompt_tokens ?? usage?.input_tokens ?? 0
  entry.outputTokens += usage?.completion_tokens ?? usage?.output_tokens ?? 0
  usageByKey.set(key, entry)
}

/** Estimated USD for a token count, or null if the model has no PRICING entry. */
export function estimateCost(model, inputTokens, outputTokens, pricing = PRICING) {
  const price = pricing[model]
  if (!price) return null
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

const round = (n) => Math.round(n * 10000) / 10000

/**
 * Per-step breakdown (most expensive first) plus total. `totalUsd` only sums
 * steps with known pricing; `unpricedModels` lists any that were skipped.
 */
export function costSummary() {
  const byStep = [...usageByKey.values()]
    .map(e => {
      const usd = estimateCost(e.model, e.inputTokens, e.outputTokens)
      return { ...e, usd: usd === null ? null : round(usd) }
    })
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))
  const totalUsd = round(byStep.reduce((sum, e) => sum + (e.usd ?? 0), 0))
  const unpricedModels = [...new Set(byStep.filter(e => e.usd === null).map(e => e.model))]
  return { totalUsd, byStep, ...(unpricedModels.length ? { unpricedModels } : {}) }
}

/** Clear all recorded usage (for tests). */
export function resetUsage() {
  usageByKey.clear()
}
