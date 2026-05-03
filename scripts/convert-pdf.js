import { PDFDocument } from 'pdf-lib'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

export async function convertPdfs(pages) {
  return Promise.all(pages.map(async page => {
    const pdfDoc = await PDFDocument.create()
    const pdfPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
    const pngImage = await pdfDoc.embedPng(page.buffer)
    pdfPage.drawImage(pngImage, { x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT })
    const pdfBuffer = Buffer.from(await pdfDoc.save())
    return { ...page, pdfBuffer }
  }))
}
