import { MODELS } from '../config/constants.js'
import { withRetry } from './with-retry.js'
import { recordUsage } from '../lib/cost-tracker.js'

const TIMEOUT_MS = 60_000

/** True when both Cloudflare Workers AI credentials are set. Pure. */
export const hasCloudflareCreds = (env = process.env) =>
  !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)

/**
 * Generate one illustration with Cloudflare Workers AI FLUX.1 [schnell].
 * Returns the raw image (base64-decoded JPEG, 1024×1024). Throws an Error with
 * `.status` on HTTP failure so withRetry retries 429/500/503.
 * Counted under the `bucket` cost step (default `cover_illustration`; pages use
 * `page_illustration`) — free tier → USD 0.
 *
 * @param {string} prompt  ≤ ~900 chars (FLUX takes ~256 tokens)
 * @param {{ env?: object, fetchImpl?: typeof fetch, retry?: object, bucket?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function generateIllustration(prompt, { env = process.env, fetchImpl = fetch, retry = {}, bucket = 'cover_illustration' } = {}) {
  if (!hasCloudflareCreds(env)) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set')
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODELS.coverIllustration}`

  const image = await withRetry(async () => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 8 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.text()
    let json = null
    try { json = JSON.parse(body) } catch { /* non-JSON error page */ }
    if (!res.ok || !json?.result?.image) {
      const detail = json?.errors ? JSON.stringify(json.errors) : body.slice(0, 200)
      throw Object.assign(new Error(`FLUX HTTP ${res.status}: ${detail}`), { status: res.status })
    }
    return json.result.image
  }, { label: 'Cloudflare FLUX', ...retry })

  recordUsage(bucket, MODELS.coverIllustration, {})
  return Buffer.from(image, 'base64')
}
