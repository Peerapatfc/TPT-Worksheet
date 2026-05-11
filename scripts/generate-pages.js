import OpenAI from 'openai'
import sharp from 'sharp'
import { validatePage } from './validate-page.js'
import { reconcilePageContent } from './reconcile-content.js'

const client = new OpenAI()
const MAX_ATTEMPTS = 5

const BASE_STYLE = 'Portrait orientation, A4 printable worksheet. Clean sans-serif font. Colorful and engaging design. Professional TPT layout.'

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
      const response = await client.images.generate({
        model: 'gpt-image-2',
        prompt,
        size: '1024x1536',
        quality: 'medium',
      })

      buffer = Buffer.from(response.data[0].b64_json, 'base64')

      const validation = await validatePage(page, buffer, plan)
      if (validation.pass) {
        await reconcilePageContent(page, buffer)
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

  return `${BASE_STYLE} ${frameStyle(plan.themeColor)} ${typeStyle} Header bar: ${headerInfo}. ${page.imagePrompt}${contentBlock}`.trim()
}
