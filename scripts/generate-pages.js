import OpenAI from 'openai'
import sharp from 'sharp'
import { validatePage } from './validate-page.js'
import { reconcilePageContent } from './reconcile-content.js'

const client = new OpenAI()
const MAX_ATTEMPTS = 5

const BASE_STYLE = 'Portrait orientation, A4 printable worksheet. Clean sans-serif font, thick border frame. Colorful and engaging design. Professional TPT layout.'

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
  const pageLabel = page.type === 'answer_key' && page.sourcePageNum
    ? `Answer Key (Page ${page.sourcePageNum})`
    : `Page ${page.pageNum} of ${plan.pageCount}`
  const headerInfo = `"${plan.setTitle}" | ${plan.gradeLevel} | ${pageLabel}`

  let contentBlock = ''
  if (page.type === 'answer_key') {
    const sourcePage = page.sourcePageNum
      ? plan.pages.find(p => p.pageNum === page.sourcePageNum)
      : null
    const questions = sourcePage?.content?.questions
      ?? plan.pages.filter(p => p.content?.questions?.length > 0).flatMap(p => p.content.questions)
    const qaLines = questions.map(q => `${q.num}. ${q.question} → ${q.answer}`)
    if (qaLines.length > 0) {
      const forLabel = sourcePage ? ` for Page ${sourcePage.pageNum}` : ''
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

  return `${BASE_STYLE} ${typeStyle} Header bar: ${headerInfo}. ${page.imagePrompt}${contentBlock}`.trim()
}
