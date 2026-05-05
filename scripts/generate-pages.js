import OpenAI from 'openai'
import sharp from 'sharp'
import { validatePage } from './validate-page.js'

const client = new OpenAI()
const MAX_RETRIES = 2

const BASE_STYLE = 'Portrait orientation, A4 printable worksheet. Clean sans-serif font, thick border frame. Colorful and engaging design. Professional TPT layout.'

const TYPE_STYLE = {
  cover: 'COVER PAGE: Large decorative title centered on page. Student name line and date line below title. Decorative thematic border or illustration. NO questions, NO exercises, NO answer spaces. Title page only.',
  worksheet: 'WORKSHEET PAGE: Clear instruction line at top. Numbered exercise items with ample blank writing space for student answers. Ruled lines or answer boxes as needed.',
  activity: 'ACTIVITY PAGE: Engaging activity layout with clear instructions. Interactive elements such as matching, cut-and-paste areas, drawing boxes, or fill-in diagrams. Ample space for student work.',
  answer_key: 'ANSWER KEY PAGE: Same layout as the corresponding worksheet but with correct answers filled in, printed in bold or underlined. Label "Answer Key" prominently at top.',
}

export async function generatePages(plan) {
  const pages = []

  for (const page of plan.pages) {
    const prompt = buildPrompt(plan, page)
    let buffer
    let attempt = 0

    while (attempt <= MAX_RETRIES) {
      const response = await client.images.generate({
        model: 'gpt-image-2',
        prompt,
        size: '1024x1536',
        quality: 'medium',
      })

      buffer = Buffer.from(response.data[0].b64_json, 'base64')

      const validation = await validatePage(page, buffer, plan)
      if (validation.pass) {
        console.log(`Generated page ${page.pageNum}/${plan.pageCount}: ${page.filename}`)
        break
      }

      attempt++
      if (attempt > MAX_RETRIES) {
        console.warn(`Page ${page.pageNum} failed validation after ${MAX_RETRIES} retries: ${validation.issues.join(', ')}`)
        break
      }

      console.log(`Page ${page.pageNum} validation failed (attempt ${attempt}): ${validation.issues.join(', ')} — retrying...`)
    }

    pages.push({ ...page, buffer })
  }

  return pages
}

function buildPrompt(plan, page) {
  const typeStyle = TYPE_STYLE[page.type] ?? TYPE_STYLE.worksheet
  const headerInfo = `"${plan.setTitle}" | ${plan.gradeLevel} | Page ${page.pageNum} of ${plan.pageCount}`

  let contentBlock = ''
  if (page.content?.questions?.length > 0) {
    const qLines = page.content.questions.map(q => `${q.num}. ${q.question}`).join('\n')
    contentBlock = ` Use these exact questions:\n${qLines}`
  } else if (page.type === 'answer_key') {
    const allQA = plan.pages
      .filter(p => p.content?.questions?.length > 0)
      .flatMap(p => p.content.questions)
      .map(q => `${q.num}. ${q.question} → ${q.answer}`)
    if (allQA.length > 0) {
      contentBlock = ` Show these questions with correct answers filled in:\n${allQA.join('\n')}`
    }
  }

  return `${BASE_STYLE} ${typeStyle} Header bar: ${headerInfo}. ${page.imagePrompt}${contentBlock}`.trim()
}
