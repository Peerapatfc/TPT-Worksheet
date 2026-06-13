import { openai } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'

const reconcileTool = {
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
}

/**
 * Re-read the generated image and correct any answers that depend on visual data
 * (graphs, charts, tables) to match what was actually drawn. Mutates page.content
 * in place. No-ops for pages without questions/visual data, and degrades gracefully
 * on API failure (keeps original Q&A).
 */
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

  let res
  try {
    res = await callTool(openai(), {
      model: MODELS.reconcile,
      maxTokens: 1024,
      tool: reconcileTool,
      label: 'OpenAI reconcile',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${buffer.toString('base64')}` } },
          { type: 'text', text: prompt },
        ],
      }],
    })
  } catch (err) {
    console.warn(`reconcilePageContent p${page.pageNum} failed (${err.status ?? err.message}) — keeping original Q&A`)
    return
  }

  if (!res.args) {
    console.warn(`reconcilePageContent p${page.pageNum}: no tool call — keeping original Q&A`)
    return
  }

  const reconciled = res.args
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
