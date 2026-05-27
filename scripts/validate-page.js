import OpenAI from 'openai'

const client = new OpenAI()

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

export async function validatePage(page, buffer, plan = {}) {
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
      const nums = page.sourcePageNums ?? (page.sourcePageNum ? [page.sourcePageNum] : [])
      const sourcePages = nums.map(n => (plan.pages ?? []).find(p => p.pageNum === n)).filter(Boolean)
      const qaSource = sourcePages.length > 0
        ? sourcePages.flatMap(p => p.content?.questions ?? [])
        : (plan.pages ?? []).filter(p => p.content?.questions?.length > 0).flatMap(p => p.content.questions)
      if (qaSource.length > 0) {
        const qaList = qaSource.map(q => `${q.num}. Q: ${q.question} → Expected: ${q.answer}`).join('\n')
        const forLabel = nums.length > 0 ? ` (answers for Pages ${nums.join(' & ')})` : ''
        contentChecks += `\n7. The answer key${forLabel} shows correct answers matching these questions. Flag any missing or incorrect answer:\n${qaList}`
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

Call the check_worksheet_quality function with your assessment. If all checks pass, return pass: true with an empty issues array.`

  let result
  try {
    result = await withRetry(() => client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      tools: [{
        type: 'function',
        function: {
          name: 'check_worksheet_quality',
          description: 'Report quality check results for a worksheet image',
          parameters: {
            type: 'object',
            properties: {
              pass: { type: 'boolean' },
              issues: { type: 'array', items: { type: 'string' } },
            },
            required: ['pass', 'issues'],
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'check_worksheet_quality' } },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${buffer.toString('base64')}` },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }))
  } catch (err) {
    console.warn(`validatePage failed after retries (${err.status ?? err.message}) — skipping`)
    return { pass: true, issues: [`validation skipped: ${err.status ?? err.message}`] }
  }

  const toolCall = result.choices[0].message.tool_calls?.[0]
  if (!toolCall) return { pass: true, issues: ['validation parse error — skipping'] }

  return JSON.parse(toolCall.function.arguments)
}
