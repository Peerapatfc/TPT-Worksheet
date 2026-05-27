import OpenAI from 'openai'
import sharp from 'sharp'
import { validatePage } from './validate-page.js'
import { reconcilePageContent } from './reconcile-content.js'

const client = new OpenAI()
const MAX_ATTEMPTS = 3

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

const BASE_STYLE = {
  cover:      'Square format, professional educator resource cover. Clean bold typography. Colorful and engaging design. NO questions, NO lines, NO answer spaces.',
  default:    'Portrait orientation, A4 printable worksheet. Clean sans-serif font. Colorful and engaging design. Professional TPT layout.',
}

const frameStyle = (hex) => `BORDER FRAME: thick solid rectangle border around entire page, color exactly ${hex}. HEADER BAR: filled rectangle at top, background color exactly ${hex}, white bold text only — no colored badges, no colored pills, no highlights on individual header items. Use this exact color ${hex} for border and header bar on this page.`

const TYPE_STYLE = {
  cover: 'COVER PAGE: Large decorative title centered on page. Student name line and date line below title. Decorative thematic border or illustration. NO questions, NO exercises, NO answer spaces. Title page only.',
  worksheet: 'WORKSHEET PAGE: Clear instruction line at top. Numbered exercise items with ample blank writing space for student answers. Ruled lines or answer boxes as needed.',
  activity: 'ACTIVITY PAGE: Engaging activity layout with clear instructions. Interactive elements such as matching, cut-and-paste areas, drawing boxes, or fill-in diagrams. Ample space for student work.',
  answer_key: 'ANSWER KEY PAGE: Label "Answer Key" prominently at top. Show numbered text answers only — bold answer number + correct answer text. DO NOT redraw any matching diagrams, coloring grids, picture graphs, or activity visuals from the worksheet. All answers must be text-based.',
}

export async function generatePages(plan) {
  const pages = []

  for (const page of plan.pages) {
    const prompt = buildPrompt(plan, page)
    let buffer

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await withRetry(() => client.images.generate({
        model: 'gpt-image-2',
        prompt,
        size: page.type === 'cover' ? '1024x1024' : '1024x1536',
        quality: 'medium',
      }))

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

    pages.push({ ...page, buffer })
  }

  return pages
}

function buildPrompt(plan, page) {
  const typeStyle = TYPE_STYLE[page.type] ?? TYPE_STYLE.worksheet
  const pageLabel = page.type === 'answer_key' && page.sourcePageNums?.length
    ? `Answer Key (Pages ${page.sourcePageNums.join(' & ')})`
    : `Page ${page.pageNum} of ${plan.pageCount}`
  const headerInfo = `"${plan.setTitle}" | ${plan.gradeLevel} | ${pageLabel}`

  let contentBlock = ''
  if (page.type === 'answer_key') {
    const nums = page.sourcePageNums ?? (page.sourcePageNum ? [page.sourcePageNum] : [])
    const sourcePages = nums.map(n => plan.pages.find(p => p.pageNum === n)).filter(Boolean)
    const questions = sourcePages.length > 0
      ? sourcePages.flatMap(p => p.content?.questions ?? [])
      : plan.pages.filter(p => p.content?.questions?.length > 0).flatMap(p => p.content.questions)
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
