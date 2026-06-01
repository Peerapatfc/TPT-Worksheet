import OpenAI from 'openai'
import sharp from 'sharp'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const client = new OpenAI()
const __dirname = dirname(fileURLToPath(import.meta.url))

async function withRetry(fn, maxAttempts = 4, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = err.status === 429 || err.status === 503 || err.status === 500
      if (!retryable || attempt === maxAttempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`OpenAI ${err.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
const LOGO_PATH = join(__dirname, '..', 'logo.png')
const LOGO_SIZE = 80
const LOGO_MARGIN = 20

async function compositeLogo(slideBuffer) {
  if (!existsSync(LOGO_PATH)) return slideBuffer
  const { data, info } = await sharp(LOGO_PATH)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(data)
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = Math.round(pixels[i] * 0.6)
  const logoBuffer = await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  const { width, height } = await sharp(slideBuffer).metadata()
  return sharp(slideBuffer)
    .composite([{ input: logoBuffer, left: width - LOGO_SIZE - LOGO_MARGIN, top: height - LOGO_SIZE - LOGO_MARGIN }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function generateSlide(prompt, quality = 'medium') {
  const response = await withRetry(() => client.images.generate({
    model: 'gpt-image-2',
    prompt,
    size: '1024x1024',
    quality,
  }))
  if (!response.data?.[0]?.b64_json) throw new Error('OpenAI image API returned no data')
  return Buffer.from(response.data[0].b64_json, 'base64')
}

export async function generateMarketingSlides(plan) {
  const worksheetPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  const answerKeyPages = plan.pages.filter(p => p.type === 'answer_key')
  const totalQuestions = worksheetPages.reduce((sum, p) => sum + (p.content?.questions?.length ?? 0), 0)

  const standards = plan.educationStandards
  const standardsBadge = standards?.framework && standards?.codes?.length ? `${standards.framework} Aligned` : ''
  const ELA_SUBJECTS = ['English Language Arts', 'Phonics & Phonological Awareness', 'Reading',
    'Science of Reading', 'Sight Words', 'Balanced Literacy', 'Grammar', 'Writing']
  const isELA = ELA_SUBJECTS.some(s => plan.tptListing?.subjectAreas?.includes(s))
  const alignmentBadge = isELA ? 'SOR Aligned' : standardsBadge

  const topicName = plan.tptListing.title.split('|')[0].trim()
  const color = plan.themeColor

  const coverPrompt = `Square 1:1 professional marketing cover graphic for a Teachers Pay Teachers educational resource. White or very light background. Large bold centered title text: "${topicName}". Smaller text below: "${plan.gradeLevel} | ${plan.subject}". Bottom banner in color ${color} with white text: "No Prep Printable • Answer Key Included". Colorful child-friendly illustration related to "${plan.subject}" and "${plan.setTitle}" filling upper area. Clean modern educator product design. No worksheet lines, no questions, no writing spaces.`

  const questionsLine = totalQuestions > 0 ? `\n✓ ${totalQuestions}+ Practice Questions` : ''
  const whatsIncludedPrompt = `Square 1:1 clean marketing slide for Teachers Pay Teachers. White background. Top filled banner in color ${color} with bold white text "WHAT'S INCLUDED". Large centered checklist with colorful checkmarks and readable font:
✓ ${worksheetPages.length} No-Prep Worksheet & Activity Pages
✓ ${answerKeyPages.length} Answer Key Page${answerKeyPages.length > 1 ? 's' : ''}
✓ ${plan.pageCount} Total Pages${questionsLine}
✓ PDF Format — Print & Go
✓ Answer Key Included for All Pages
Professional clean layout. Accent color ${color}. No illustrations, focus on text readability.`

  const alignmentLine = alignmentBadge ? ` Bottom badge: "${alignmentBadge}".` : ''
  const benefitsPrompt = `Square 1:1 marketing slide for Teachers Pay Teachers. White background. Large bold headline: "NO PREP • PRINT & GO". Medium sub-headline below: "Perfect for:". Grid or list of use cases with small colorful icons: Whole Class • Small Groups • Homework • Morning Work • Sub Plans • Intervention. Bottom colored banner in ${color}.${alignmentLine} Modern professional design. Bold readable fonts.`

  console.log('Generating marketing slides...')
  const [coverRaw, whatsIncludedRaw, benefitsRaw] = await Promise.all([
    generateSlide(coverPrompt, 'medium'),
    generateSlide(whatsIncludedPrompt, 'low'),
    generateSlide(benefitsPrompt, 'low'),
  ])

  const [cover, whatsIncluded, benefits] = await Promise.all([
    compositeLogo(coverRaw),
    compositeLogo(whatsIncludedRaw),
    compositeLogo(benefitsRaw),
  ])
  console.log('Marketing slides done.')

  return [
    { filename: 'marketing-cover', buffer: cover },
    { filename: 'marketing-whats-included', buffer: whatsIncluded },
    { filename: 'marketing-benefits', buffer: benefits },
  ]
}
