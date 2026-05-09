import { PDFDocument, rgb, degrees } from 'pdf-lib'
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

async function buildPreviewPdf(pages) {
  const PREVIEW_PAGE_LIMIT = 4
  const previewPages = [
    ...pages.filter(p => p.type === 'cover'),
    ...pages.filter(p => p.type === 'worksheet' || p.type === 'activity').slice(0, PREVIEW_PAGE_LIMIT - 1),
  ].slice(0, PREVIEW_PAGE_LIMIT)

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont('Helvetica-Bold')

  for (const page of previewPages) {
    await bufferToPdfPage(pdfDoc, page.buffer)
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

export async function convertPdfs(pages) {
  const results = await Promise.all(pages.map(pageToPdf))
  const pagesWithPdf = results.map(r => ({ ...r.page, pdfBuffer: r.pdfBuffer }))

  const [combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer] = await Promise.all([
    buildCombinedPdf(pages, true),
    buildCombinedPdf(pages, false),
    buildPreviewPdf(pages),
  ])

  return { pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer }
}
