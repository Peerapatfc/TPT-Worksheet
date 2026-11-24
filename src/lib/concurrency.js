/**
 * Map over items with a bounded number of concurrent workers, preserving input order.
 * With `limit = 1` this is exactly sequential.
 *
 * @param {T[]} items
 * @param {number} limit  max concurrent invocations (clamped to >= 1)
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 * @template T, R
 */
export async function mapWithConcurrency(items, limit, fn) {
  const max = Math.max(1, limit | 0)
  const results = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker))
  return results
}

/**
 * Read a positive-integer concurrency setting from an env-like object.
 * Missing, non-numeric, fractional-garbage, zero or negative values -> `fallback`.
 * Pure — exported for unit testing.
 */
export function readConcurrency(env, name, fallback) {
  const raw = String(env?.[name] ?? '').trim()
  if (!/^\d+$/.test(raw)) return fallback
  const n = Number(raw)
  return n >= 1 ? n : fallback
}
