import { GoogleGenerativeAI } from '@google/generative-ai'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

async function withRetry(fn, maxAttempts = 4, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = err.status === 503 || err.status === 429
      if (!retryable || attempt === maxAttempts) throw err
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`Gemini ${err.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

async function fetchContent(model, plan, contentPages) {
  const pageDescriptions = contentPages
    .map(p => `- Page ${p.pageNum} (${p.type}): ${p.imagePrompt}`)
    .join('\n')

  const prompt = `You are a curriculum designer creating printable worksheets for Teachers Pay Teachers.

Set: "${plan.setTitle}"
Grade: ${plan.gradeLevel}
Subject: ${plan.subject}

Generate exact questions and correct answers for each worksheet/activity page below.
Write questions appropriate for ${plan.gradeLevel} level. Questions must be clear, printable, and answerable in writing.
For Math: use specific numbers and calculations. For ELA: use clear sentence prompts. For Science/Social Studies: fact-based questions.
Each page: 4–8 questions. All answers must be factually and academically correct.

Pages:
${pageDescriptions}

Return JSON:
{
  "pages": [
    {
      "pageNum": number,
      "title": "string (short descriptive page title)",
      "questions": [
        { "num": 1, "question": "string", "answer": "string" }
      ]
    }
  ]
}`

  let result
  try {
    result = await withRetry(() => model.generateContent(prompt))
  } catch (err) {
    console.warn(`generateContent fetch failed (${err.status ?? err.message})`)
    return null
  }

  try {
    return JSON.parse(result.response.text())
  } catch {
    console.warn('generateContent: invalid JSON from Gemini')
    return null
  }
}

function validateSchema(contentData, contentPages) {
  const issues = []
  const contentMap = new Map(contentData.pages.map(p => [p.pageNum, p]))

  for (const page of contentPages) {
    const content = contentMap.get(page.pageNum)
    if (!content) {
      issues.push(`page ${page.pageNum} missing`)
      continue
    }
    if (!Array.isArray(content.questions) || content.questions.length === 0) {
      issues.push(`page ${page.pageNum} has no questions`)
      continue
    }
    if (content.questions.length < 4) {
      issues.push(`page ${page.pageNum} has only ${content.questions.length} questions (min 4)`)
    }
    for (const q of content.questions) {
      if (!q.question?.trim()) issues.push(`page ${page.pageNum} q${q.num} empty question`)
      if (!q.answer?.trim()) issues.push(`page ${page.pageNum} q${q.num} empty answer`)
    }
  }

  return issues
}

async function validateAndCorrect(model, plan, contentData) {
  const prompt = `You are an academic fact-checker for elementary school worksheets.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Review every question and answer below. For each item check ALL of:
1. The answer is academically correct (math calculations, spelling, grammar, facts, logic)
2. The answer actually and specifically answers its question — not just correct in isolation
3. The question is appropriate in difficulty for ${plan.gradeLevel} level
4. If wrong, mismatched, or inappropriate, provide the corrected answer

${JSON.stringify(contentData.pages, null, 2)}

Return JSON:
{
  "pass": true or false,
  "corrections": [
    { "pageNum": number, "questionNum": number, "correctedAnswer": "string", "reason": "string" }
  ]
}

If all answers are correct and appropriate, return { "pass": true, "corrections": [] }`

  let result
  try {
    result = await withRetry(() => model.generateContent(prompt))
  } catch (err) {
    console.warn(`validateAndCorrect failed (${err.status ?? err.message}) — using content as-is`)
    return contentData
  }

  let validation
  try {
    validation = JSON.parse(result.response.text())
  } catch {
    console.warn('validateAndCorrect: invalid JSON — using content as-is')
    return contentData
  }

  if (validation.pass || !validation.corrections?.length) return contentData

  console.log(`Content accuracy: ${validation.corrections.length} correction(s) applied`)

  const correctionMap = new Map(
    validation.corrections.map(c => [`${c.pageNum}-${c.questionNum}`, c])
  )

  const correctedPages = contentData.pages.map(page => ({
    ...page,
    questions: page.questions.map(q => {
      const fix = correctionMap.get(`${page.pageNum}-${q.num}`)
      if (fix) {
        console.log(`  p${page.pageNum} q${q.num}: "${q.answer}" → "${fix.correctedAnswer}" (${fix.reason})`)
        return { ...q, answer: fix.correctedAnswer }
      }
      return q
    }),
  }))

  return { ...contentData, pages: correctedPages }
}

export async function generateContent(plan) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  })

  const contentPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  if (contentPages.length === 0) return plan

  const MAX_RETRIES = 2
  let contentData = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    contentData = await fetchContent(model, plan, contentPages)
    if (!contentData) return plan

    const schemaIssues = validateSchema(contentData, contentPages)
    if (schemaIssues.length > 0) {
      console.warn(`generateContent schema (attempt ${attempt}/${MAX_RETRIES + 1}): ${schemaIssues.join(', ')}`)
      if (attempt <= MAX_RETRIES) continue
      console.warn('generateContent: schema still invalid after retries — using best available content')
    }

    contentData = await validateAndCorrect(model, plan, contentData)
    break
  }

  const slug = plan.setTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const date = new Date().toISOString().split('T')[0]
  try {
    mkdirSync(join('logs'), { recursive: true })
    writeFileSync(
      join('logs', `content-${date}-${slug}.json`),
      JSON.stringify(contentData, null, 2),
    )
    console.log(`Content saved: logs/content-${date}-${slug}.json`)
  } catch (err) {
    console.warn(`generateContent: failed to save JSON (${err.message})`)
  }

  const contentMap = new Map(contentData.pages.map(p => [p.pageNum, p]))
  const updatedPages = plan.pages.map(page => {
    const content = contentMap.get(page.pageNum)
    return content ? { ...page, content } : page
  })

  return { ...plan, pages: updatedPages }
}
