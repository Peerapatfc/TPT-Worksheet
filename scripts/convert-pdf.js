import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

async function bufferToPdfPage(pdfDoc, imgBuffer) {
  const pngImage = await pdfDoc.embedPng(imgBuffer)
  const { width: imgW, height: imgH } = pngImage
  const scale = Math.min(A4_WIDTH / imgW, A4_HEIGHT / imgH)
  const pdfPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
  pdfPage.drawImage(pngImage, {
    x: (A4_WIDTH - imgW * scale) / 2,
    y: (A4_HEIGHT - imgH * scale) / 2,
    width: imgW * scale,
    height: imgH * scale,
  })
}

async function pageToPdf(page) {
  const pdfDoc = await PDFDocument.create()
  const grayscaleBuffer = await sharp(page.buffer).grayscale().png().toBuffer()
  await bufferToPdfPage(pdfDoc, grayscaleBuffer)
  return { page, pdfBuffer: Buffer.from(await pdfDoc.save()) }
}

async function buildCombinedPdf(pages, grayscale) {
  const pdfDoc = await PDFDocument.create()
  for (const page of pages) {
    const imgBuffer = grayscale
      ? await sharp(page.buffer).grayscale().png().toBuffer()
      : page.buffer
    await bufferToPdfPage(pdfDoc, imgBuffer)
  }
  return Buffer.from(await pdfDoc.save())
}

export async function convertPdfs(pages) {
  const results = await Promise.all(pages.map(pageToPdf))
  const pagesWithPdf = results.map(r => ({ ...r.page, pdfBuffer: r.pdfBuffer }))

  const [combinedPdfBuffer, colorCombinedPdfBuffer] = await Promise.all([
    buildCombinedPdf(pages, true),
    buildCombinedPdf(pages, false),
  ])

  return { pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer }
}
