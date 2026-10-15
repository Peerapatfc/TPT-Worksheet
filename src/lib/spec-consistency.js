// The image is drawn from a page's imageSpec and the student page prints it
// verbatim, so any quotation a question asks about must also appear in the spec —
// otherwise the worksheet asks about text the picture never shows.

const QUOTED = /[“"]([^“”"]+)[”"]/g
const MIN_WORDS = 4

const normalize = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** Quoted phrases of at least MIN_WORDS words in `text`, normalized. */
export function quotedPhrases(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(QUOTED)) {
    const phrase = normalize(m[1])
    if (phrase.split(' ').length >= MIN_WORDS) out.push(phrase)
  }
  return out
}

/**
 * Quoted phrases used in `questions` that the page's `imageSpec` never prints.
 * Returns [] when the page has no spec (nothing is drawn from it).
 * Pure — exported for unit testing and the eval.
 */
export function quotesMissingFromSpec(imageSpec, questions) {
  if (!String(imageSpec ?? '').trim()) return []
  const spec = normalize(imageSpec)
  const missing = new Set()
  for (const q of questions ?? []) {
    for (const phrase of quotedPhrases(q.question)) {
      if (!spec.includes(phrase)) missing.add(phrase)
    }
  }
  return [...missing]
}
