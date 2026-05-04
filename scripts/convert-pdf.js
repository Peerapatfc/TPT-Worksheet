import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

async function pageToPdf(page) {
  const pdfDoc = await PDFDocument.create()
  const pdfPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
  const grayscaleBuffer = await sharp(page.buffer).grayscale().png().toBuffer()
  const pngImage = await pdfDoc.embedPng(grayscaleBuffer)
  const { width: imgW, height: imgH } = pngImage
  const scale = Math.min(A4_WIDTH / imgW, A4_HEIGHT / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  pdfPage.drawImage(pngImage, {
    x: (A4_WIDTH - drawW) / 2,
    y: (A4_HEIGHT - drawH) / 2,
    width: drawW,
    height: drawH,
  })
  return { page, pdfBuffer: Buffer.from(await pdfDoc.save()) }
}

export async function convertPdfs(pages) {
  const results = await Promise.all(pages.map(pageToPdf))
  const pagesWithPdf = results.map(r => ({ ...r.page, pdfBuffer: r.pdfBuffer }))

  const combinedDoc = await PDFDocument.create()
  for (const { pdfBuffer } of results) {
    const src = await PDFDocument.load(pdfBuffer)
    const [copied] = await combinedDoc.copyPages(src, [0])
    combinedDoc.addPage(copied)
  }
  const combinedPdfBuffer = Buffer.from(await combinedDoc.save())

  return { pagesWithPdf, combinedPdfBuffer }
}
