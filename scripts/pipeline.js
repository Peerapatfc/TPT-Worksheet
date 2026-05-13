import 'dotenv/config'
import { brainstorm } from './brainstorm.js'
import { generateContent } from './generate-content.js'
import { generatePages } from './generate-pages.js'
import { convertPdfs } from './convert-pdf.js'
import { uploadDrive } from './upload-drive.js'
import { notifyTelegram } from './notify-telegram.js'
import { readTopicHistory, saveTopicEntry } from './topic-history.js'
import { appendLog } from './logger.js'

const runDate = new Date().toISOString().split('T')[0]

function getPackageType() {
  const day = new Date().getDay()
  const freeDay = parseInt(process.env.FREE_WORKSHEET_DAY ?? '0', 10)
  const largeDayRaw = process.env.LARGE_PACKAGE_DAY
  const largeDay = largeDayRaw != null ? parseInt(largeDayRaw, 10) : -1
  if (day === freeDay) return 'free'
  if (largeDay >= 0 && day === largeDay) return 'large'
  return 'small'
}

async function main() {
  const start = Date.now()
  const packageType = getPackageType()
  appendLog({ step: 'start', status: 'ok', timestamp: new Date().toISOString(), packageType })

  const history = await readTopicHistory()
  appendLog({ step: 'load_history', status: 'ok', count: history.length })

  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' })
  const plan = await brainstorm(
    process.env.GRADE_LEVEL || null,
    parseInt(process.env.MAX_PAGES_PER_SET ?? '30', 10),
    history,
    packageType,
    currentMonth,
  )
  appendLog({ step: 'brainstorm', status: 'ok', topic: plan.setTitle, pageCount: plan.pageCount, packageType })

  const planWithContent = await generateContent(plan)
  appendLog({ step: 'generate_content', status: 'ok' })

  const pages = await generatePages(planWithContent)
  appendLog({ step: 'generate_images', status: 'ok', generated: pages.length })

  const { pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer } = await convertPdfs(pages)
  appendLog({ step: 'convert_pdf', status: 'ok' })

  const folder = await uploadDrive(plan, pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer, runDate)
  appendLog({ step: 'upload_drive', status: 'ok', folderLink: folder.link })

  await saveTopicEntry({
    setTitle: plan.setTitle,
    subject: plan.subject,
    gradeLevel: plan.gradeLevel,
    keywords: plan.tptListing?.keywords ?? [],
    date: runDate,
    folderId: folder.folderId,
  })
  appendLog({ step: 'save_history', status: 'ok' })

  await notifyTelegram(plan, pagesWithPdf[0].buffer, folder.link)
  appendLog({ step: 'telegram', status: 'ok' })

  appendLog({ step: 'done', status: 'ok', durationMs: Date.now() - start })
}

main().catch(err => {
  appendLog({ step: 'fatal', status: 'error', error: err.message, timestamp: new Date().toISOString() })
  console.error(err)
  process.exit(1)
})
