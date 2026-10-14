import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { convertPdfs } from '../src/steps/convert-pdf.js'

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
