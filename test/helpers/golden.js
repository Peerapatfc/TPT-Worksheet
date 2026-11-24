// Perceptual golden-image check for code-rendered pages. Both images are
// downscaled to a small greyscale thumbnail and compared pixel by pixel, so
// sub-pixel anti-aliasing differences between macOS and the Linux CI runner do
// not matter while a moved block, a different font or a missing element does.
// UPDATE_GOLDENS=1 (or a missing golden) writes the current render as the golden.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const GOLDEN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../goldens')

const thumb = (input, width) => sharp(input).flatten({ background: '#ffffff' }).resize({ width, kernel: 'lanczos3' }).greyscale().raw().toBuffer({ resolveWithObject: true })

/**
 * @returns {Promise<{ mean: number, changed: number, written?: boolean }>} mean = mean absolute
 *   difference (0–255), changed = fraction of thumbnail pixels differing by more than 48.
 */
export async function diffGolden(png, name, { width = 256 } = {}) {
  const file = path.join(GOLDEN_DIR, `${name}.png`)
  const cur = await thumb(png, width)
  if (process.env.UPDATE_GOLDENS === '1' || !existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(file, await sharp(cur.data, { raw: { width: cur.info.width, height: cur.info.height, channels: 1 } }).png().toBuffer())
    return { mean: 0, changed: 0, written: true }
  }
  const gold = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  if (gold.info.width !== cur.info.width || gold.info.height !== cur.info.height) return { mean: 255, changed: 1 }
  let sum = 0
  let changed = 0
  for (let i = 0; i < cur.data.length; i++) {
    const d = Math.abs(cur.data[i] - gold.data[i * gold.info.channels])
    sum += d
    if (d > 48) changed++
  }
  return { mean: sum / cur.data.length, changed: changed / cur.data.length }
}
