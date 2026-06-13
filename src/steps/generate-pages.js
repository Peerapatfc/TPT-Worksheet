import sharp from 'sharp'
import { openai } from '../llm/clients.js'
import { withRetry } from '../llm/with-retry.js'
import { MODELS, IMAGE_SIZE } from '../config/constants.js'
import { resolveSourceQuestions } from '../lib/source-pages.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { validatePage } from './validate-page.js'
import { reconcilePageContent } from './reconcile-content.js'

const MAX_ATTEMPTS = 3

const BASE_STYLE = {
  cover:   'Square format, professional educator resource cover. Clean bold typography. Colorful and engaging design. NO questions, NO lines, NO answer spaces.',
  default: 'Portrait orientation, A4 printable worksheet. Clean sans-serif font. Colorful and engaging design. Professional TPT layout.',
}

const frameStyle = (hex) => `BORDER FRAME: thick solid rectangle border around entire page, color exactly ${hex}. HEADER BAR: filled rectangle at top, background color exactly ${hex}, white bold text only — no colored badges, no colored pills, no highlights on individual header items. Use this exact color ${hex} for border and header bar on this page.`

const TYPE_STYLE = {
  cover: 'COVER PAGE: Large decorative title centered on page. Student name line and date line below title. Decorative thematic border or illustration. NO questions, NO exercises, NO answer spaces. Title page only.',
  worksheet: 'WORKSHEET PAGE: Clear instruction line at top. Numbered exercise items with ample blank writing space for student answers. Ruled lines or answer boxes as needed.',
  activity: 'ACTIVITY PAGE: Engaging activity layout with clear instructions. Interactive elements such as matching, cut-and-paste areas, drawing boxes, or fill-in diagrams. Ample space for student work.',
  answer_key: 'ANSWER KEY PAGE: Label "Answer Key" prominently at top. Show numbered text answers only — bold answer number + correct answer text. DO NOT redraw any matching diagrams, coloring grids, picture graphs, or activity visuals from the worksheet. All answers must be text-based.',
}

/**
 * Generate every page image for a plan.
 *
 * Pages are generated with bounded concurrency (env `PAGE_CONCURRENCY`, default 1
 * = sequential, preserving the original cost/rate-limit profile). Each page is
 * image-generated, vision-validated, and (if it has an imageSpec) answer-reconciled,
 * retrying up to MAX_ATTEMPTS on validation failure. Output order matches plan.pages.
 */
export async function generatePages(plan) {
  const concurrency = parseInt(process.env.PAGE_CONCURRENCY ?? '1', 10) || 1
  return mapWithConcurrency(plan.pages, concurrency, page => generateOnePage(plan, page))
}

async function generateOnePage(plan, page) {
  const prompt = buildPrompt(plan, page)
  const client = openai()
  let buffer

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await withRetry(() => client.images.generate({
      model: MODELS.image,
      prompt,
      size: page.type === 'cover' ? IMAGE_SIZE.cover : IMAGE_SIZE.page,
      quality: page.type === 'cover' ? 'high' : page.type === 'answer_key' ? 'low' : 'medium',
    }), { label: `OpenAI image p${page.pageNum}` })

    if (!response.data?.[0]?.b64_json) throw new Error(`OpenAI image API returned no data for page ${page.pageNum}`)
    buffer = Buffer.from(response.data[0].b64_json, 'base64')

    const validation = await validatePage(page, buffer, plan)
    if (validation.pass) {
      if (page.content?.imageSpec) await reconcilePageContent(page, buffer)
      buffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer()
      console.log(`Generated page ${page.pageNum}/${plan.pageCount}: ${page.filename} (attempt ${attempt})`)
      break
    }

    if (attempt === MAX_ATTEMPTS) {
      console.warn(`Page ${page.pageNum} failed validation after ${MAX_ATTEMPTS} attempts: ${validation.issues.join(', ')}`)
    } else {
      console.log(`Page ${page.pageNum} validation failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${validation.issues.join(', ')} — retrying...`)
    }
  }

  return { ...page, buffer }
}

/**
 * Build the full gpt-image-2 prompt for a single page. Pure function (no IO) —
 * exported for unit testing.
 */
export function buildPrompt(plan, page) {
  const typeStyle = TYPE_STYLE[page.type] ?? TYPE_STYLE.worksheet
  const pageLabel = page.type === 'answer_key' && page.sourcePageNums?.length
    ? `Answer Key (Pages ${page.sourcePageNums.join(' & ')})`
    : `Page ${page.pageNum} of ${plan.pageCount}`
  const headerInfo = `"${plan.setTitle}" | ${plan.gradeLevel} | ${pageLabel}`

  let contentBlock = ''
  if (page.type === 'answer_key') {
    const { nums, questions } = resolveSourceQuestions(page, plan.pages)
    let seq = 1
    const qaLines = questions.map(q => `${seq++}. ${q.question} → ${q.answer}`)
    if (qaLines.length > 0) {
      const forLabel = nums.length > 0 ? ` for Pages ${nums.join(' & ')}` : ''
      contentBlock = ` Answers${forLabel} — text only, do not redraw any diagrams:\n${qaLines.join('\n')}`
    }
  } else if (page.content) {
    const specPart = page.content.imageSpec
      ? ` EXACT VISUAL DATA — draw precisely as specified: ${page.content.imageSpec}`
      : ''
    const qPart = page.content.questions?.length > 0
      ? ` Questions to include:\n${page.content.questions.map(q => `${q.num}. ${q.question}`).join('\n')}`
      : ''
    contentBlock = specPart + qPart
  }

  const baseStyle = BASE_STYLE[page.type] ?? BASE_STYLE.default
  return `${baseStyle} ${frameStyle(plan.themeColor)} ${typeStyle} Header bar: ${headerInfo}. ${page.imagePrompt}${contentBlock}`.trim()
}
