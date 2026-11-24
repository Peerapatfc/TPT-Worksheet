// Deterministic stand-in for a prepared FLUX illustration (no network): a simple
// code-drawn sun-and-hill picture with a transparent background, as a data URI.
import sharp from 'sharp'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="400">
<ellipse cx="240" cy="330" rx="230" ry="70" fill="#7CB342"/>
<circle cx="240" cy="170" r="110" fill="#F4B400"/>
<circle cx="205" cy="150" r="14" fill="#333"/><circle cx="275" cy="150" r="14" fill="#333"/>
<path d="M195 205 Q240 245 285 205" stroke="#333" stroke-width="10" fill="none" stroke-linecap="round"/>
</svg>`

let cached = null
/** @returns {Promise<{ href: string, width: number, height: number }>} */
export async function stubIllustration() {
  if (!cached) {
    const png = await sharp(Buffer.from(SVG)).png().toBuffer()
    cached = { href: `data:image/png;base64,${png.toString('base64')}`, width: 480, height: 400 }
  }
  return cached
}
