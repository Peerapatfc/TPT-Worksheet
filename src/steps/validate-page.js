import sharp from 'sharp'
import { openai } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'

// Short side of the image sent for QA (env QA_SHORT_SIDE overrides). gpt-4o-mini
// bills vision by 512px tiles after fitting the short side to 768: a 1024x1536
// page is 6 tiles (~37k tokens); 640x960 is 4 tiles. 512x768 (2 tiles) was too
// small to read question text and produced false "wording mismatch" failures.
const QA_SHORT_SIDE = parseInt(process.env.QA_SHORT_SIDE ?? '640', 10)

// The model only transcribes and reports observations; judgeReport() decides
// pass/fail in code. Letting gpt-4o-mini judge was unreliable both ways: it
// called "14 tickets" printed instead of "18 tickets" minor, and flagged
// "Spiders have six legs" (a Fact-or-Myth item printed exactly) as a wrong
// number. So it transcribes each question and code compares the numbers.
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
              printed: {
                type: 'string',
                description: 'The question exactly as printed on the page, character for character (keep every number). Empty string if it is not on the page or is cut off.',
              },
            },
            required: ['num', 'printed'],
          },
        },
        garbledText: { type: 'boolean', description: 'Some text is garbled, misspelled nonsense, or unreadable' },
        noAnswerSpace: { type: 'boolean', description: 'Worksheet/activity only: there is nowhere for students to write or mark answers' },
        answersShown: { type: 'boolean', description: 'Worksheet/activity only: the student page gives away answers — e.g. a clue followed by its answer word ("Silk producer – SPIN"), blanks already filled in, matching lines already drawn, or circled/checked choices. Answer OPTIONS to choose from (a word bank, matching columns) are not answers.' },
        headerMissing: { type: 'boolean', description: 'The header with the set title is missing' },
        hasQuestionsOnCover: { type: 'boolean', description: 'Cover only: the cover shows questions, exercises, or answer blanks' },
        minorNotes: { type: 'array', items: { type: 'string' }, description: 'Cosmetic observations only' },
      },
      required: ['questions', 'garbledText', 'noAnswerSpace', 'answersShown', 'headerMissing', 'hasQuestionsOnCover'],
    },
  },
}

const VULGAR_FRACTIONS = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅛': '1/8' }

// Numbers in a question, normalized: vulgar fractions expanded, thousands
// separators dropped ("45,000" -> "45000"), and a leading enumeration label
// ("Statement 7:", "3.", "Q2)") removed since the image may number it differently.
function numbersIn(text) {
  const normalized = String(text ?? '')
    .replace(/[½⅓⅔¼¾⅕⅛]/g, ch => VULGAR_FRACTIONS[ch])
    .replace(/^\s*(?:(?:statement|question|problem|q)\s*)?\d+\s*[:.)]\s*/i, '')
  return (normalized.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => n.replace(/,/g, ''))
}

/**
 * Compare a listed question with its transcription. Every number in the listed
 * question must appear in the printed one (extra printed numbers are tolerated).
 * Pure — exported for unit testing.
 */
export function compareQuestion(listed, printed) {
  if (!String(printed ?? '').trim()) return 'missing'
  const remaining = numbersIn(printed)
  for (const n of numbersIn(listed)) {
    const i = remaining.indexOf(n)
    if (i === -1) return 'number_differs'
    remaining.splice(i, 1)
  }
  return 'match'
}

/**
 * Decide pass/fail from the model's observations. A page fails (and is paid to
 * regenerate) only for a missing question, a changed number, garbled text, no
 * answer space, answers shown on a student page, a missing header, or
 * questions on a cover. Pure — exported for
 * unit testing.
 * @returns {{ pass: boolean, issues: string[] }}
 */
export function judgeReport(report = {}, page = {}) {
  const critical = []
  const isCover = page.type === 'cover'
  const printedByNum = new Map((report.questions ?? []).map(q => [q.num, q.printed]))

  if (!isCover) {
    for (const q of page.content?.questions ?? []) {
      const status = compareQuestion(q.question, printedByNum.get(q.num))
      if (status === 'missing') critical.push(`q${q.num} missing`)
      if (status === 'number_differs') critical.push(`q${q.num} number_differs: listed "${q.question}" / printed "${printedByNum.get(q.num)}"`)
    }
  }
  if (report.garbledText) critical.push('garbled text')
  if (report.headerMissing) critical.push('header missing')
  if (!isCover && report.noAnswerSpace) critical.push('no answer space')
  if (!isCover && report.answersShown) critical.push('answers shown on student page')
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
    ? `For each of these LISTED questions, find it on the page and transcribe it exactly as printed (keep every number). Do not judge whether statements are true.\n${questions.map(q => `${q.num}. ${q.question}`).join('\n')}\n\n`
    : ''

  return `You are checking a printable Teachers Pay Teachers ${page.type} page for the set "${plan.setTitle ?? ''}".
${isCover ? 'This is a COVER page: it should show the title and artwork, with no questions.' : `This is a STUDENT ${page.type} page: it is SUPPOSED to have blank answer spaces and NO answers (the answer key is a separate page).`}

${questionBlock}Report only what you observe.
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
