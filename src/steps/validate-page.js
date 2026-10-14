import sharp from 'sharp'
import { openai } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'

// Short side of the image sent for QA (env QA_SHORT_SIDE overrides). gpt-4o-mini
// bills vision by 512px tiles after fitting the short side to 768: a 1024x1536
// page is 6 tiles (~37k tokens); 640x960 is 4 tiles. 512x768 (2 tiles) was too
// small to read question text and produced false "wording mismatch" failures.
const QA_SHORT_SIDE = parseInt(process.env.QA_SHORT_SIDE ?? '640', 10)

// The model reports observations; judgeReport() decides pass/fail in code.
// (Letting gpt-4o-mini pick a "critical/minor" severity was unreliable: it
// called "14 tickets" printed instead of "18 tickets" minor.)
const qualityTool = {
  type: 'function',
  function: {
    name: 'report_page_check',
    description: 'Report what you observe on the page. Do not judge overall quality.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'One entry per LISTED question (empty for a cover page).',
          items: {
            type: 'object',
            properties: {
              num: { type: 'integer' },
              status: {
                type: 'string',
                enum: ['match', 'wording_differs', 'number_differs', 'missing'],
                description: 'match = same text; wording_differs = same numbers/meaning, different words; number_differs = any number or value differs; missing = not on the page or cut off',
              },
              note: { type: 'string' },
            },
            required: ['num', 'status'],
          },
        },
        garbledText: { type: 'boolean', description: 'Some text is garbled, misspelled nonsense, or unreadable' },
        noAnswerSpace: { type: 'boolean', description: 'Worksheet/activity only: there is nowhere for students to write or mark answers' },
        headerMissing: { type: 'boolean', description: 'The header with the set title is missing' },
        hasQuestionsOnCover: { type: 'boolean', description: 'Cover only: the cover shows questions, exercises, or answer blanks' },
        minorNotes: { type: 'array', items: { type: 'string' }, description: 'Cosmetic observations only' },
      },
      required: ['questions', 'garbledText', 'noAnswerSpace', 'headerMissing', 'hasQuestionsOnCover'],
    },
  },
}

const FAILING_STATUSES = new Set(['number_differs', 'missing'])

/**
 * Decide pass/fail from the model's observations. A page fails (and is paid to
 * regenerate) only for a missing question, a changed number, garbled text, no
 * answer space, a missing header, or questions on a cover. Pure — exported for
 * unit testing.
 * @returns {{ pass: boolean, issues: string[] }}
 */
export function judgeReport(report = {}, page = {}) {
  const critical = []
  const isCover = page.type === 'cover'
  const expected = new Set((page.content?.questions ?? []).map(q => q.num))

  for (const q of report.questions ?? []) {
    if (!isCover && expected.has(q.num) && FAILING_STATUSES.has(q.status)) {
      critical.push(`q${q.num} ${q.status}${q.note ? `: ${q.note}` : ''}`)
    }
  }
  if (report.garbledText) critical.push('garbled text')
  if (report.headerMissing) critical.push('header missing')
  if (!isCover && report.noAnswerSpace) critical.push('no answer space')
  if (isCover && report.hasQuestionsOnCover) critical.push('questions on cover')

  const minor = report.minorNotes ?? []
  return {
    pass: critical.length === 0,
    issues: [...critical.map(c => `[critical] ${c}`), ...minor.map(m => `[minor] ${m}`)],
  }
}

/**
 * Build the QA prompt for a cover/worksheet/activity page (answer keys are
 * template-rendered and never validated). Pure — exported for unit testing.
 */
export function buildValidationPrompt(page, plan = {}) {
  const isCover = page.type === 'cover'
  const questions = page.content?.questions ?? []
  const questionBlock = !isCover && questions.length
    ? `Compare the page against these LISTED questions, one by one. Check every number carefully:\n${questions.map(q => `${q.num}. ${q.question}`).join('\n')}\n\n`
    : ''

  return `You are checking a printable Teachers Pay Teachers ${page.type} page for the set "${plan.setTitle ?? ''}".
${isCover ? 'This is a COVER page: it should show the title and artwork, with no questions.' : `This is a STUDENT ${page.type} page: it is SUPPOSED to have blank answer spaces and NO answers (the answer key is a separate page).`}

${questionBlock}Report only what you observe. If you cannot read some text clearly, treat it as "match" rather than guessing.
Call report_page_check.`
}

/**
 * Vision QA on a generated page image. Returns { pass, issues }.
 * On any API/parse failure it returns pass:true (fail-open) so a flaky validator
 * never blocks the pipeline — the issue string records why it was skipped.
 */
export async function validatePage(page, buffer, plan = {}) {
  const small = await sharp(buffer)
    .resize({ width: QA_SHORT_SIDE, height: QA_SHORT_SIDE, fit: 'outside' })
    .png()
    .toBuffer()

  let res
  try {
    res = await callTool(openai(), {
      model: MODELS.validate,
      maxTokens: 600,
      tool: qualityTool,
      label: 'OpenAI validate',
      step: 'validate_page',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${small.toString('base64')}` } },
          { type: 'text', text: buildValidationPrompt(page, plan) },
        ],
      }],
    })
  } catch (err) {
    console.warn(`validatePage failed after retries (${err.status ?? err.message}) — skipping`)
    return { pass: true, issues: [`validation skipped: ${err.status ?? err.message}`] }
  }

  if (!res.args) return { pass: true, issues: ['validation parse error — skipping'] }
  return judgeReport(res.args, page)
}
