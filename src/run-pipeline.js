import { brainstorm } from './steps/brainstorm.js'
import { generateContent } from './steps/generate-content.js'
import { generatePages } from './steps/generate-pages.js'
import { generateMarketingSlides } from './steps/generate-marketing-slides.js'
import { convertPdfs } from './steps/convert-pdf.js'
import { uploadDrive, checkGoogleToken } from './steps/upload-drive.js'
import { notifyTelegram } from './steps/notify-telegram.js'
import { readTopicHistory, saveTopicEntry } from './steps/topic-history.js'
import { appendLog } from './lib/logger.js'
import { getPackageType } from './lib/package-type.js'

/**
 * Full daily pipeline: history → brainstorm → content → images (+ marketing) →
 * PDFs → Drive upload → history save → Telegram notify. Each step appends a
 * structured log line. Marketing slides are non-essential and degrade gracefully;
 * any other step failure aborts the run (and the CI opens a failure issue).
 */
export async function runPipeline() {
  const runDate = new Date().toISOString().split('T')[0]
  const start = Date.now()
  const packageType = getPackageType()
  appendLog({ step: 'start', status: 'ok', packageType })

  await checkGoogleToken()
  appendLog({ step: 'check_google_token', status: 'ok' })

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

  const [pages, marketingSlides] = await Promise.all([
    generatePages(planWithContent),
    generateMarketingSlides(planWithContent).catch(err => {
      console.warn(`Marketing slides failed — continuing without them: ${err.message}`)
      appendLog({ step: 'generate_marketing_slides', status: 'warn', error: err.message })
      return []
    }),
  ])
  appendLog({ step: 'generate_images', status: 'ok', generated: pages.length, marketingSlides: marketingSlides.length })

  const { pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer } = await convertPdfs(pages)
  appendLog({ step: 'convert_pdf', status: 'ok' })

  const folder = await uploadDrive(plan, pagesWithPdf, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer, runDate, marketingSlides)
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
