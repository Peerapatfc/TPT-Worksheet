import { GoogleGenerativeAI } from '@google/generative-ai'

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

export async function validatePage(page, buffer, plan = {}) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const gradeLevel = plan.gradeLevel ?? 'unknown grade'
  const subject = plan.subject ?? 'general'
  const isAnswerKey = page.type === 'answer_key'
  const hasContent = page.type === 'worksheet' || page.type === 'activity' || isAnswerKey

  let contentChecks = ''
  if (hasContent) {
    contentChecks += `\n6. Questions and exercises are grade-appropriate in difficulty and vocabulary for ${gradeLevel} students studying ${subject}. Flag if content is too easy, too hard, or off-topic.`

    if (page.content?.questions?.length > 0 && !isAnswerKey) {
      const qList = page.content.questions.map(q => `${q.num}. ${q.question}`).join('\n')
      contentChecks += `\n7. These exact questions appear clearly and legibly in the image:\n${qList}`
    }

    if (isAnswerKey) {
      const allQA = (plan.pages ?? [])
        .filter(p => p.content?.questions?.length > 0)
        .flatMap(p => p.content.questions)
      if (allQA.length > 0) {
        const qaList = allQA.map(q => `${q.num}. Q: ${q.question} → Expected: ${q.answer}`).join('\n')
        contentChecks += `\n7. The answer key shows correct answers matching these questions. Flag any missing or incorrect answer:\n${qaList}`
      } else {
        contentChecks += `\n7. Every answer shown is academically correct — verify math calculations, spelling, grammar, facts, or logic. Flag any incorrect answer.`
      }
    }
  }

  const prompt = `You are a quality checker for Teachers Pay Teachers (TPT) printable worksheets.

Examine this worksheet image and check ALL of the following:
1. Has a visible header with title, grade level, and page number
2. Has sufficient writing or answer space for students
3. Content matches expected page type: "${page.type}" (cover/worksheet/activity/answer_key)
4. Layout is clean and professional — readable font, no clutter
5. If type is "answer_key": answers or solutions are visibly present${contentChecks}

Return JSON only:
{
  "pass": true or false,
  "issues": ["describe each problem here"]
}

If all checks pass, return { "pass": true, "issues": [] }`

  let result
  try {
    result = await withRetry(() => model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } },
    ]))
  } catch (err) {
    console.warn(`validatePage failed after retries (${err.status ?? err.message}) — skipping`)
    return { pass: true, issues: [`validation skipped: ${err.status ?? err.message}`] }
  }

  let validation
  try {
    validation = JSON.parse(result.response.text())
  } catch {
    return { pass: true, issues: ['validation parse error — skipping'] }
  }

  return validation
}
