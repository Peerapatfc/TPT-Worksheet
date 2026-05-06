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

export async function reconcilePageContent(page, buffer) {
  if (page.type !== 'worksheet' && page.type !== 'activity') return
  if (!page.content?.questions?.length) return

  const qList = page.content.questions
    .map(q => `${q.num}. Q: ${q.question} | A: ${q.answer}`)
    .join('\n')

  const prompt = `You are verifying that worksheet answers match the visual data shown in this image.

Pre-generated questions and answers:
${qList}

Examine the image carefully. Identify any visual data sources (picture graphs with icon counts, bar charts with heights, data tables, number lines, diagrams with specific values).

Read the ACTUAL values from the image exactly as drawn.
For each question that depends on visual data: recalculate the correct answer using what you actually see in the image.
For questions that do NOT depend on visual data (pure math facts, vocabulary, definitions): keep the original answer unchanged.

Call the reconcile_answers function. If no visual data is found in the image, set hasVisualData to false and return an empty questions array.`

  let result
  try {
    result = await withRetry(() => client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      tools: [{
        type: 'function',
        function: {
          name: 'reconcile_answers',
          description: 'Reconcile worksheet answers against actual visual data in the image',
          parameters: {
            type: 'object',
            properties: {
              hasVisualData: { type: 'boolean' },
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    num: { type: 'integer' },
                    question: { type: 'string' },
                    answer: { type: 'string' },
                  },
                  required: ['num', 'question', 'answer'],
                },
              },
            },
            required: ['hasVisualData', 'questions'],
          },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'reconcile_answers' } },
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
    console.warn(`reconcilePageContent p${page.pageNum} failed (${err.status ?? err.message}) — keeping original Q&A`)
    return
  }

  const toolCall = result.choices[0].message.tool_calls?.[0]
  if (!toolCall) {
    console.warn(`reconcilePageContent p${page.pageNum}: no tool call — keeping original Q&A`)
    return
  }

  const reconciled = JSON.parse(toolCall.function.arguments)

  if (!reconciled.hasVisualData || !reconciled.questions?.length) return

  const updatedMap = new Map(reconciled.questions.map(q => [q.num, q.answer]))
  let corrected = 0

  page.content.questions = page.content.questions.map(q => {
    const newAnswer = updatedMap.get(q.num)
    if (newAnswer && newAnswer !== q.answer) {
      console.log(`  Reconcile p${page.pageNum} q${q.num}: "${q.answer}" → "${newAnswer}"`)
      corrected++
      return { ...q, answer: newAnswer }
    }
    return q
  })

  if (corrected > 0) {
    console.log(`Page ${page.pageNum} reconciled: ${corrected} answer(s) corrected from actual image`)
  }
}
