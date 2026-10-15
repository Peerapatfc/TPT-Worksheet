// Local helper: pull the page images back out of a pipeline PDF (one embedded
// image per page) so a reviewer can look at every page. The per-page PNGs are no
// longer uploaded to Drive, and there is no PDF rasterizer on the dev machine.
//
//   node scripts/extract-pdf-pages.js <set.pdf> <out-dir> [--sheets]
//
// Writes page-01.png … and, with --sheets, contact-1.jpg … (6 pages per sheet,
// readable at full width) for a quick visual pass.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'
import sharp from 'sharp'

const [pdfPath, outDir, ...flags] = process.argv.slice(2)
if (!pdfPath || !outDir) {
  console.error('usage: node scripts/extract-pdf-pages.js <set.pdf> <out-dir> [--sheets]')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const doc = await PDFDocument.load(readFileSync(pdfPath))
const lookup = (v) => (v instanceof PDFRef ? doc.context.lookup(v) : v)
const pages = doc.getPages()
const files = []

for (const [i, page] of pages.entries()) {
  const xobjects = lookup(lookup(page.node.Resources()).get(PDFName.of('XObject')))
  const [, ref] = xobjects.entries()[0]
  const image = lookup(ref)
  if (!(image instanceof PDFRawStream)) throw new Error(`page ${i + 1}: unsupported image object`)
  const d = image.dict
  const width = lookup(d.get(PDFName.of('Width'))).asNumber()
  const height = lookup(d.get(PDFName.of('Height'))).asNumber()
  const filter = lookup(d.get(PDFName.of('Filter')))?.toString()
  const raw = Buffer.from(image.contents)
  let png
  if (filter === '/DCTDecode') {
    png = await sharp(raw).png().toBuffer()
  } else if (filter === '/FlateDecode') {
    const px = inflateSync(raw)
    const channels = px.length / (width * height)
    if (!Number.isInteger(channels)) throw new Error(`page ${i + 1}: unexpected pixel layout`)
    png = await sharp(px, { raw: { width, height, channels } }).png().toBuffer()
  } else {
    throw new Error(`page ${i + 1}: unsupported filter ${filter}`)
  }
  const file = join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`)
  writeFileSync(file, png)
  files.push(file)
}
console.log(`${files.length} pages → ${outDir}`)

if (flags.includes('--sheets')) {
  const W = 640, H = 960, PER = 3
  for (let s = 0; s * PER * 2 < files.length; s++) {
    const group = files.slice(s * PER * 2, s * PER * 2 + PER * 2)
    const tiles = await Promise.all(group.map(async (f, k) => ({
      input: await sharp(f).resize({ width: W, height: H, fit: 'contain', background: '#777' }).toBuffer(),
      left: (k % PER) * (W + 6),
      top: Math.floor(k / PER) * (H + 6),
    })))
    const out = join(outDir, `contact-${s + 1}.jpg`)
    await sharp({ create: { width: PER * (W + 6), height: 2 * (H + 6), channels: 3, background: '#777' } })
      .composite(tiles).jpeg({ quality: 88 }).toFile(out)
    console.log(out)
  }
}
