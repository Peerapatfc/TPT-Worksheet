import { openai } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'
import { resolveSourceQuestions } from '../lib/source-pages.js'

const qualityTool = {
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
}

/**
 * Vision QA on a generated page image. Returns { pass, issues }.
 * On any API/parse failure it returns pass:true (fail-open) so a flaky validator
 * never blocks the pipeline — the issue string records why it was skipped.
 */
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
      const { nums, questions: qaSource } = resolveSourceQuestions(page, plan.pages ?? [])
      if (qaSource.length > 0) {
        const qaList = qaSource.map(q => `${q.num}. Q: ${q.question} → Expected: ${q.answer}`).join('\n')
        const forLabel = nums.length > 0 ? ` (answers for Pages ${nums.join(' & ')})` : ''
        contentChecks += `\n7. The answer key${forLabel} shows correct answers matching these questions. Accept semantically equivalent answers — do not fail for minor wording differences. Only flag clearly wrong or missing answers:\n${qaList}`
      } else {
        contentChecks += `\n7. Every answer shown is academically correct — verify math calculations, spelling, grammar, facts, or logic. Flag any incorrect answer.`
      }
    }
  }

  const isCover = page.type === 'cover'
  const needsWritingSpace = page.type === 'worksheet' || page.type === 'activity'
  const writingSpaceCheck = needsWritingSpace
    ? '\n2. Has sufficient writing or answer space for students'
    : isCover
      ? '\n2. Is visually appealing as a cover page (no writing space required)'
      : '\n2. Answers are clearly printed (no student writing space required for answer keys)'

  const prompt = `You are a quality checker for Teachers Pay Teachers (TPT) printable worksheets.

Examine this worksheet image and check ALL of the following:
1. Has a visible header with title, grade level, and page number${writingSpaceCheck}
3. Content matches expected page type: "${page.type}" (cover/worksheet/activity/answer_key)
4. Layout is clean and professional — readable font, no clutter
5. If type is "answer_key": answers or solutions are visibly present${contentChecks}

Call the check_worksheet_quality function with your assessment. If all checks pass, return pass: true with an empty issues array.`

  let res
  try {
    res = await callTool(openai(), {
      model: MODELS.validate,
      maxTokens: 256,
      tool: qualityTool,
      label: 'OpenAI validate',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${buffer.toString('base64')}` } },
          { type: 'text', text: prompt },
        ],
      }],
    })
  } catch (err) {
    console.warn(`validatePage failed after retries (${err.status ?? err.message}) — skipping`)
    return { pass: true, issues: [`validation skipped: ${err.status ?? err.message}`] }
  }

  if (!res.args) return { pass: true, issues: ['validation parse error — skipping'] }
  return res.args
}
