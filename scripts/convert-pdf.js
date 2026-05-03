import { PDFDocument } from 'pdf-lib'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

export async function convertPdfs(pages) {
  return Promise.all(pages.map(async page => {
    const pdfDoc = await PDFDocument.create()
    const pdfPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
    const pngImage = await pdfDoc.embedPng(page.buffer)
    const { width: imgW, height: imgH } = pngImage
    const scale = Math.min(A4_WIDTH / imgW, A4_HEIGHT / imgH)
    const drawW = imgW * scale
    const drawH = imgH * scale
    const x = (A4_WIDTH - drawW) / 2
    const y = (A4_HEIGHT - drawH) / 2
    pdfPage.drawImage(pngImage, { x, y, width: drawW, height: drawH })
    const pdfBuffer = Buffer.from(await pdfDoc.save())
    return { ...page, pdfBuffer }
  }))
}
