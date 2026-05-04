import 'dotenv/config'
import { brainstorm } from './brainstorm.js'
import { generatePages } from './generate-pages.js'
import { convertPdfs } from './convert-pdf.js'
import { uploadDrive } from './upload-drive.js'
import { notifyTelegram } from './notify-telegram.js'
import { readTopicHistory, saveTopicEntry } from './topic-history.js'
import { appendLog } from './logger.js'

const runDate = new Date().toISOString().split('T')[0]

async function main() {
  const start = Date.now()
  appendLog({ step: 'start', status: 'ok', timestamp: new Date().toISOString() })

  const history = await readTopicHistory()
  appendLog({ step: 'load_history', status: 'ok', count: history.length })

  const plan = await brainstorm(
    process.env.GRADE_LEVEL || null,
    parseInt(process.env.MAX_PAGES_PER_SET ?? '8', 10),
    history,
  )
  appendLog({ step: 'brainstorm', status: 'ok', topic: plan.setTitle, pageCount: plan.pageCount })

  const pages = await generatePages(plan)
  appendLog({ step: 'generate_images', status: 'ok', generated: pages.length })

  const { pagesWithPdf, combinedPdfBuffer } = await convertPdfs(pages)
  appendLog({ step: 'convert_pdf', status: 'ok' })

  const folder = await uploadDrive(plan, pagesWithPdf, combinedPdfBuffer, runDate)
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
