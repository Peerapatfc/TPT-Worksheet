import { google } from 'googleapis'
import { createHash, randomUUID } from 'crypto'
import { Readable } from 'stream'

function getDrive() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN })
  return google.drive({ version: 'v3', auth })
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
}

async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({

    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, webViewLink',
  })
  return res.data
}

async function uploadBuffer(drive, buffer, filename, mimeType, folderId) {
  const res = await drive.files.create({

    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, webViewLink',
  })
  return res.data
}

export async function uploadDrive(plan, pages, combinedPdfBuffer, colorCombinedPdfBuffer, previewPdfBuffer, runDate, marketingSlides = []) {
  const drive = getDrive()
  const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID
  const setSlug = `${slugify(plan.setTitle)}-${randomUUID().slice(0, 8)}`
  const folderName = `${runDate}_${setSlug}`

  const folder = await createFolder(drive, folderName, parentId)
  const folderId = folder.id
  const fileIds = {}

  for (const page of pages) {
    const pngFile = await uploadBuffer(drive, page.buffer, `${page.filename}.png`, 'image/png', folderId)
    const pdfFile = await uploadBuffer(drive, page.pdfBuffer, `${page.filename}.pdf`, 'application/pdf', folderId)
    fileIds[page.filename] = { png: pngFile.id, pdf: pdfFile.id }
    console.log(`Uploaded ${page.filename} (PNG + PDF)`)
  }

  for (const slide of marketingSlides) {
    await uploadBuffer(drive, slide.buffer, `${slide.filename}.png`, 'image/png', folderId)
    console.log(`Uploaded ${slide.filename}.png`)
  }

  const metadata = {
    setTitle: plan.setTitle,
    subject: plan.subject,
    gradeLevel: plan.gradeLevel,
    pageCount: plan.pageCount,
    runDate,
    generatedAt: new Date().toISOString(),
    pages: pages.map(p => ({
      filename: p.filename,
      type: p.type,
      sha256: createHash('sha256').update(p.buffer).digest('hex'),
      driveIds: fileIds[p.filename],
    })),
    tptListing: plan.tptListing,
    driveFolder: folder.webViewLink,
  }

  await uploadBuffer(
    drive,
    Buffer.from(JSON.stringify(metadata, null, 2)),
    'metadata.json',
    'application/json',
    folderId,
  )

  const standards = plan.educationStandards
  const standardsLines = standards?.framework && standards?.codes?.length
    ? ['', `EDUCATION STANDARDS (${standards.framework}):`, ...standards.codes.map(c => `  ${c}`)]
    : ['', 'EDUCATION STANDARDS: N/A (not Math, ELA, or Science)']

  const worksheetPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  const answerKeyPages = plan.pages.filter(p => p.type === 'answer_key')
  const totalQuestions = worksheetPages.reduce((sum, p) => sum + (p.content?.questions?.length ?? 0), 0)

  const tptText = [
    `TITLE: ${plan.tptListing.title}`,
    '',
    `DESCRIPTION:\n${plan.tptListing.description}`,
    '',
    `KEYWORDS: ${plan.tptListing.keywords.join(', ')}`,
    '',
    `SUBJECT AREAS: ${plan.tptListing.subjectAreas.join(', ')}`,
    '',
    `TAGS: ${plan.tptListing.tags.join(', ')}`,
    '',
    `SUGGESTED PRICE: $${plan.tptListing.suggestedPrice.toFixed(2)}`,
    '',
    `GRADE LEVEL: ${plan.gradeLevel}`,
    `SUBJECT: ${plan.subject}`,
    `FORMAT: PDF | No Prep | Print & Go | Answer Key Included`,
    `PAGES: ${plan.pageCount} (includes answer key)`,
    `ANSWER KEY: Yes`,
    `TEACHING DURATION: ${plan.tptListing.teachingDuration}`,
    '',
    `WHAT'S INCLUDED:`,
    `  • ${worksheetPages.length} No-Prep Worksheet/Activity Pages`,
    `  • ${answerKeyPages.length} Answer Key Page(s)`,
    `  • ${plan.pageCount} Total Pages`,
    ...(totalQuestions > 0 ? [`  • ${totalQuestions}+ Practice Problems/Questions`] : []),
    `  • PDF Format — Print & Go, No Prep Needed`,
    `  • Answer Key Included for All Pages`,
    ...standardsLines,
  ].join('\n')

  await uploadBuffer(drive, Buffer.from(tptText), 'tpt-listing.txt', 'text/plain', folderId)

  const slug = slugify(plan.setTitle)
  const combinedFilename = `${slug}-complete-set.pdf`
  const colorCombinedFilename = `${slug}-complete-set-color.pdf`
  const previewFilename = `${slug}-preview.pdf`

  await Promise.all([
    uploadBuffer(drive, combinedPdfBuffer, combinedFilename, 'application/pdf', folderId),
    uploadBuffer(drive, colorCombinedPdfBuffer, colorCombinedFilename, 'application/pdf', folderId),
    uploadBuffer(drive, previewPdfBuffer, previewFilename, 'application/pdf', folderId),
  ])
  console.log(`Uploaded combined PDFs (grayscale + color + preview)`)

  const tptRootId = process.env.GOOGLE_DRIVE_TPT_FOLDER_ID
  if (tptRootId) {
    const tptSubfolder = await createFolder(drive, folderName, tptRootId)
    await Promise.all([
      uploadBuffer(drive, combinedPdfBuffer, combinedFilename, 'application/pdf', tptSubfolder.id),
      uploadBuffer(drive, colorCombinedPdfBuffer, colorCombinedFilename, 'application/pdf', tptSubfolder.id),
      uploadBuffer(drive, previewPdfBuffer, previewFilename, 'application/pdf', tptSubfolder.id),
    ])
    console.log(`Uploaded combined PDFs to TPT subfolder: ${folderName}`)
  }

  return { link: folder.webViewLink, folderId }
}
