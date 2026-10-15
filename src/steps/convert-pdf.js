import { PDFDocument, rgb, degrees } from 'pdf-lib'
import sharp from 'sharp'
import { A4 } from '../config/constants.js'

// Page images are 1024x1536 PNGs of AI art (a PNG of one is ~1.2 MB, JPEG q90 ~0.25 MB with
// no visible loss, even zoomed in on text). Embedding JPEGs keeps a 19-page color set around
// 4 MB instead of ~20 MB, which uploads to Drive/TPT faster and fits the ~10 MB limit of the
// browser-automation file upload. Pages that are flat text (answer keys, chart pages) don't
// shrink with JPEG and would only gain artifacts, so those stay PNG.
export const JPEG_QUALITIES = [90, 85, 80]
const JPEG_MUST_BE_SMALLER_THAN = 0.7 // of the PNG size
const PREVIEW_QUALITY = 85
export const MAX_SET_BYTES = 9 * 1024 * 1024

/**
 * Encode one page image for embedding: JPEG at `quality` when that is clearly smaller than
 * the PNG, otherwise keep the PNG. Pure apart from sharp — exported for unit testing.
 * @returns {Promise<{ format: 'jpg'|'png', data: Buffer }>}
 */
export async function encodePage(pngBuffer, quality) {
  const jpg = await sharp(pngBuffer)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer()
  return jpg.length < pngBuffer.length * JPEG_MUST_BE_SMALLER_THAN
    ? { format: 'jpg', data: jpg }
    : { format: 'png', data: pngBuffer }
}

/** Embed an encoded page centered and aspect-fit onto a new A4 page. */
async function embedToPage(pdfDoc, encoded) {
  const image = encoded.format === 'jpg' ? await pdfDoc.embedJpg(encoded.data) : await pdfDoc.embedPng(encoded.data)
  const { width: imgW, height: imgH } = image
  const scale = Math.min(A4.width / imgW, A4.height / imgH)
  const pdfPage = pdfDoc.addPage([A4.width, A4.height])
  pdfPage.drawImage(image, {
    x: (A4.width - imgW * scale) / 2,
    y: (A4.height - imgH * scale) / 2,
    width: imgW * scale,
    height: imgH * scale,
  })
}

const toGrayscale = (buffer) => sharp(buffer).grayscale().png().toBuffer()

/**
 * Merge page images into one PDF. Starts at the best JPEG quality and steps down only if the
 * file is over `maxBytes` (a very long set); warns if even the lowest step is too big.
 * Exported for unit testing.
 */
export async function buildCombinedPdf(buffers, maxBytes = MAX_SET_BYTES) {
  let pdf
  for (const quality of JPEG_QUALITIES) {
    const encoded = await Promise.all(buffers.map(b => encodePage(b, quality)))
    const pdfDoc = await PDFDocument.create()
    for (const e of encoded) await embedToPage(pdfDoc, e)
    pdf = Buffer.from(await pdfDoc.save())
    if (pdf.length <= maxBytes) return pdf
  }
  console.warn(`PDF is ${(pdf.length / 1e6).toFixed(1)} MB even at JPEG quality ${JPEG_QUALITIES.at(-1)} (limit ${(maxBytes / 1e6).toFixed(1)} MB)`)
  return pdf
}

async function buildPreviewPdf(pages) {
  const PREVIEW_PAGE_LIMIT = 4
  const previewPages = [
    ...pages.filter(p => p.type === 'cover'),
    ...pages.filter(p => p.type === 'worksheet' || p.type === 'activity').slice(0, PREVIEW_PAGE_LIMIT - 1),
  ].slice(0, PREVIEW_PAGE_LIMIT)

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont('Helvetica-Bold')

  for (const page of previewPages) {
    await embedToPage(pdfDoc, await encodePage(page.buffer, PREVIEW_QUALITY))
    const pdfPage = pdfDoc.getPages().at(-1)
    const { width, height } = pdfPage.getSize()
    pdfPage.drawText('PREVIEW', {
      x: width / 2 - 120,
      y: height / 2 - 30,
      size: 80,
      font,
      color: rgb(0.85, 0.85, 0.85),
      opacity: 0.45,
      rotate: degrees(45),
    })
  }

  return Buffer.from(await pdfDoc.save())
}

/**
 * Convert generated page images into the set's PDFs:
 *   - a combined color PDF (the product file sold on TPT)
 *   - a combined grayscale PDF (kept in the assets folder as a printer-friendly option)
 *   - a watermarked color preview PDF (TPT "Product Previews" slot)
 * No per-page PDFs — nothing used them.
 */
export async function convertPdfs(pages) {
  const grayBuffers = await Promise.all(pages.map(p => toGrayscale(p.buffer)))

  const [combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer] = await Promise.all([
    buildCombinedPdf(grayBuffers),
    buildCombinedPdf(pages.map(p => p.buffer)),
    buildPreviewPdf(pages),
  ])

  return { combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer }
}
