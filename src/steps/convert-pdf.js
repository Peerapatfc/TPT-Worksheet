import { PDFDocument, rgb, degrees } from 'pdf-lib'
import sharp from 'sharp'
import { A4 } from '../config/constants.js'

/** Embed a PNG buffer centered and aspect-fit onto a new A4 page. */
async function embedToPage(pdfDoc, imgBuffer) {
  const pngImage = await pdfDoc.embedPng(imgBuffer)
  const { width: imgW, height: imgH } = pngImage
  const scale = Math.min(A4.width / imgW, A4.height / imgH)
  const pdfPage = pdfDoc.addPage([A4.width, A4.height])
  pdfPage.drawImage(pngImage, {
    x: (A4.width - imgW * scale) / 2,
    y: (A4.height - imgH * scale) / 2,
    width: imgW * scale,
    height: imgH * scale,
  })
}

const toGrayscale = (buffer) => sharp(buffer).grayscale().png().toBuffer()

async function buildCombinedPdf(buffers) {
  const pdfDoc = await PDFDocument.create()
  for (const buf of buffers) await embedToPage(pdfDoc, buf)
  return Buffer.from(await pdfDoc.save())
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
    await embedToPage(pdfDoc, page.buffer)
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
