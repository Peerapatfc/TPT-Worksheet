// In-process list of things a human should check before listing the set:
// pages that never passed QA, questions/answers the recheck changed, answers
// stripped from image specs, and steps that fell back. Sent with the Telegram
// notification and logged at the end of the run.
const notes = []

/** @param {'qa_failed'|'overflow'|'degraded'|'question_rewritten'|'answer_corrected'|'answer_leak'|'fallback'|'image_spec_updated'|'spec_mismatch'} kind */
export function addReviewNote(kind, message) {
  notes.push({ kind, message })
}

export function reviewNotes() {
  return [...notes]
}

/** Clear all notes (for tests). */
export function resetReviewNotes() {
  notes.length = 0
}

const SECTIONS = [
  ['qa_failed', '⚠️ Pages that failed QA after all retries — check these first'],
  ['degraded', '⚠️ Pages simplified by the zero-OpenAI renderer — check these questions/answers'],
  ['overflow', '📏 Pages shrunk or trimmed to fit (hybrid-only overflow fallback)'],
  ['spec_mismatch', '⚠️ Recheck rewrites reverted — the picture would not match; verify these answers'],
  ['fallback', '⚠️ Steps that fell back'],
  ['question_rewritten', '✏️ Questions rewritten by the recheck'],
  ['answer_corrected', '✏️ Answers corrected by the recheck'],
  ['image_spec_updated', '🖼️ Image specs rewritten to match corrected questions'],
  ['answer_leak', '🧹 Answers removed from image specs'],
]

/**
 * Plain-text review summary for Telegram (sent without parse_mode, so no
 * escaping). Truncated to stay under Telegram's 4096-char message limit.
 * `hybridOnly` ({ openaiCalls, openaiUsd }) adds the zero-OpenAI line and shows the
 * Groq figure as a paid-rate estimate (the free tier bills $0).
 * Pure — exported for unit testing.
 */
export function buildReviewMessage(setTitle, notesList, totalUsd, maxLength = 4000, { hybridOnly = null } = {}) {
  const lines = [`🔍 Review: ${setTitle}`]
  if (hybridOnly) {
    lines.push(`🆓 Hybrid-only run (PAGE_RENDERER=hybrid-only): ${hybridOnly.openaiCalls ?? 0} OpenAI calls, OpenAI cost $${(hybridOnly.openaiUsd ?? 0).toFixed(2)}`)
    if (typeof totalUsd === 'number') lines.push(`💵 API cost: $0.00 on free tiers (Groq paid-rate estimate $${totalUsd.toFixed(2)})`)
  } else if (typeof totalUsd === 'number') lines.push(`💵 API cost: $${totalUsd.toFixed(2)}`)
  if (notesList.length === 0) {
    lines.push('', '✅ Nothing flagged — spot-check as usual.')
  }
  for (const [kind, heading] of SECTIONS) {
    const items = notesList.filter(n => n.kind === kind)
    if (items.length === 0) continue
    lines.push('', `${heading} (${items.length}):`, ...items.map(n => `• ${n.message}`))
  }
  const text = lines.join('\n')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 20).trimEnd()}\n… (truncated)`
}
