import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { answerKeySvg, renderSvg } from '../src/lib/svg-templates.js'
import { convertPdfs, encodePage, buildCombinedPdf, JPEG_QUALITIES } from '../src/steps/convert-pdf.js'

const png = (r, g, b) => sharp({ create: { width: 64, height: 96, channels: 3, background: { r, g, b } } }).png().toBuffer()

describe('convertPdfs', () => {
  it('builds color + grayscale sets and a preview, and no per-page PDFs', async () => {
    const pages = [
      { type: 'cover', buffer: await png(200, 0, 0) },
      { type: 'worksheet', buffer: await png(0, 200, 0) },
      { type: 'worksheet', buffer: await png(0, 0, 200) },
      { type: 'answer_key', buffer: await png(50, 50, 50) },
    ]
    const out = await convertPdfs(pages)
    expect(Object.keys(out).sort()).toEqual(['colorCombinedPdfBuffer', 'combinedPdfBuffer', 'previewPdfBuffer'])
    const count = async buf => (await PDFDocument.load(buf)).getPageCount()
    expect(await count(out.colorCombinedPdfBuffer)).toBe(4)
    expect(await count(out.combinedPdfBuffer)).toBe(4)
    expect(await count(out.previewPdfBuffer)).toBe(3) // cover + first worksheets, no answer key
  })
})

// A smooth, painterly-looking page (gradient + a little texture): PNG stays big, JPEG is tiny.
const art = (seed = 0) => {
  const w = 256, h = 384
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    const t = Math.sin((x + seed * 13) / 9) * Math.cos(y / 11) * 12
    px[i] = (x * 255 / w + t + (x * y + seed) % 7) & 255
    px[i + 1] = (y * 255 / h + t + (x + y * 3) % 5) & 255
    px[i + 2] = ((x + y) * 255 / (w + h) + t + (x * 7 + y) % 6) & 255
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer()
}
// A real answer-key page, rendered the way the pipeline renders it.
const flat = () => renderSvg(answerKeySvg(
  { setTitle: 'Fractions', gradeLevel: 'Grade 3', themeColor: '#1B4F8A', pages: [{ pageNum: 2, content: { questions: Array.from({ length: 6 }, (_, i) => ({ num: i + 1, question: `Question number ${i + 1} about fractions?`, answer: `Answer ${i + 1}` })) } }] },
  { type: 'answer_key', sourcePageNums: [2] },
))

describe('encodePage', () => {
  it('uses JPEG for artwork when it is clearly smaller', async () => {
    const page = await art()
    const out = await encodePage(page, 90)
    expect(out.format).toBe('jpg')
    expect(out.data.length).toBeLessThan(page.length * 0.7)
  })

  it('keeps flat text pages as PNG', async () => {
    const page = await flat()
    const out = await encodePage(page, 90)
    expect(out.format).toBe('png')
    expect(out.data).toBe(page)
  })
})

describe('buildCombinedPdf', () => {
  it('embeds artwork as JPEG so the set is much smaller than a PNG-only PDF', async () => {
    const pages = [await art(1), await art(2), await art(3)]
    const pdf = await buildCombinedPdf(pages)
    const pngOnly = await PDFDocument.create()
    for (const p of pages) { const img = await pngOnly.embedPng(p); pngOnly.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 }) }
    const pngSize = (await pngOnly.save()).length
    expect(pdf.toString('latin1')).toContain('/DCTDecode')
    expect(pdf.length).toBeLessThan(pngSize * 0.7)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3)
  })

  it('steps the JPEG quality down when the set is over the size limit, then warns', async () => {
    const pages = [await art(4), await art(5)]
    const first = await buildCombinedPdf(pages, Infinity)
    const sizes = []
    for (const q of JPEG_QUALITIES) sizes.push((await Promise.all(pages.map(p => encodePage(p, q)))).reduce((n, e) => n + e.data.length, 0))
    expect(sizes[1]).toBeLessThan(sizes[0])
    const capped = await buildCombinedPdf(pages, 1) // impossible limit → lowest quality
    expect(capped.length).toBeLessThan(first.length)
  })
})
