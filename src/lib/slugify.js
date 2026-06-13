/**
 * Convert arbitrary text to a URL/filename-safe slug.
 * Lowercases, collapses non-alphanumerics to single hyphens, and trims edge hyphens.
 *
 * @param {string} text
 * @param {number} [maxLength] optional hard cap on slug length
 * @returns {string}
 */
export function slugify(text, maxLength) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return maxLength ? slug.slice(0, maxLength) : slug
}
