import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { groq } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'
import { slugify } from '../lib/slugify.js'
import { addReviewNote } from '../lib/review-notes.js'
import { quotesMissingFromSpec } from '../lib/spec-consistency.js'
import { validateChart, CHART_TYPES, CHART_ICONS, CHART_LIMITS } from '../lib/chart-page.js'

const contentTool = {
  type: 'function',
  function: {
    name: 'generate_page_content',
    description: 'Generate questions and image specifications for worksheet pages',
    parameters: {
      type: 'object',
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              title: { type: 'string' },
              imageSpec: { type: 'string', description: 'Exact visual data spec, or empty string if no visualization (always empty when chart is set)' },
              chart: {
                type: 'object',
                description: 'ONLY for a picture graph, bar graph, or simple category/number table. Drawn exactly by code — omit for every other page.',
                properties: {
                  type: { type: 'string', enum: CHART_TYPES },
                  title: { type: 'string' },
                  icon: { type: 'string', enum: CHART_ICONS, description: 'pictograph only' },
                  unit: { type: 'string', description: 'singular noun one icon/unit stands for, e.g. "acorn"' },
                  labelHeader: { type: 'string', description: 'table only: first column header' },
                  valueHeader: { type: 'string', description: 'table only: second column header' },
                  categories: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { label: { type: 'string' }, value: { type: 'integer' } },
                      required: ['label', 'value'],
                    },
                  },
                },
                required: ['type', 'title', 'categories'],
              },
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
            required: ['pageNum', 'title', 'imageSpec', 'questions'],
          },
        },
      },
      required: ['pages'],
    },
  },
}

const validateTool = {
  type: 'function',
  function: {
    name: 'validate_content',
    description: 'Validate and correct worksheet Q&A for academic accuracy',
    parameters: {
      type: 'object',
      properties: {
        pass: { type: 'boolean' },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              questionNum: { type: 'integer' },
              correctedAnswer: { type: 'string' },
              correctedQuestion: { type: 'string', description: 'Rewritten question, only when the original is ambiguous or opinion-based' },
              reason: { type: 'string' },
            },
            required: ['pageNum', 'questionNum', 'correctedAnswer', 'reason'],
          },
        },
        imageSpecCorrections: {
          type: 'array',
          description: 'Full replacement imageSpec for a page whose rewritten questions or answers depend on something the picture prints (a quote, label, name or number). Omit when no page needs one.',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              correctedImageSpec: { type: 'string', description: 'The COMPLETE corrected imageSpec for the page, not a diff' },
              reason: { type: 'string' },
            },
            required: ['pageNum', 'correctedImageSpec', 'reason'],
          },
        },
      },
      required: ['pass', 'corrections'],
    },
  },
}

async function fetchContent(plan, contentPages) {
  const pageDescriptions = contentPages
    .map(p => `- Page ${p.pageNum} (${p.type}): ${p.imagePrompt}`)
    .join('\n')

  const prompt = `You are a curriculum designer creating printable worksheets for Teachers Pay Teachers.

Set: "${plan.setTitle}"
Grade: ${plan.gradeLevel}
Subject: ${plan.subject}

For each worksheet/activity page, follow TWO steps in order:

STEP 1 — Define imageSpec (exact visual blueprint):
If the page needs a data visualization, define ALL values precisely so an AI image generator can draw it exactly:
- Picture graphs, bar graphs, and simple category/number tables: do NOT describe them in imageSpec. Fill "chart" instead — code draws it exactly, so the answer key always matches. Whole numbers only; picture graph ≤${CHART_LIMITS.pictograph.maxCategories} categories and ≤${CHART_LIMITS.pictograph.maxValue} per category (one icon = 1 unit), bar graph ≤${CHART_LIMITS.bar.maxCategories} bars with values ≤${CHART_LIMITS.bar.maxValue}, table ≤${CHART_LIMITS.table.maxCategories} rows. Leave imageSpec "" on chart pages. Every question on a chart page must be answerable by reading the chart.
- Number sequences / patterns: list every term explicitly
- Matching activities (draw-a-line): list left column items top-to-bottom, then list right column items in a SHUFFLED order (NOT the same order as left column) so correct answers require diagonal or non-straight lines. Specify both columns explicitly: "Left (top to bottom): A, B, C, D. Right (top to bottom, shuffled): C, A, D, B." Every left item MUST have its correct match among the right items — never list a quote, term or picture whose answer is not in the other column.
- Quotations: only use a quotation if you are certain of the speaker, and only attribute it to someone in the activity. Questions may only quote text that the imageSpec prints.
AVOID visual types that AI cannot render accurately:
- Base-10 blocks with subdivisions (use text "3 tens 2 ones" format instead)
- Analog clocks with exact hand positions
- Protractors, rulers with exact measurements
- Geometric shapes requiring precise angles/dimensions
- Crossword puzzles, word searches, mazes, dot-to-dot (grids and paths cannot be drawn consistently). If a page description asks for one, make it a matching, fill-in-the-blank, or labeling activity on the same content instead.
imageSpec describes only what is printed on the STUDENT page — never include answers (no "– COB" after a clue, no filled-in blanks, no lines already drawn between matches).
For pages with NO data visualization (pure text questions, writing prompts): set imageSpec to ""

STEP 2 — Generate Q&A from your imageSpec:
- Every answer must be derivable from the exact data in imageSpec
- ${plan.packageType === 'free' ? '4–5' : plan.packageType === 'large' ? '5–8' : '4–6'} questions per page, appropriate for ${plan.gradeLevel}
- For Math: use exact numbers from imageSpec. For ELA: clear sentence prompts. For Science/Social Studies: fact-based.
- All answers must be factually and academically correct.
- Every question must have exactly ONE correct answer that can be checked against the imageSpec or established facts.
- Do NOT ask opinion or guessing questions ("Who is likely to…", "What do you think…", "Which is your favorite…").
- Knowledge questions are fine (e.g. "Which habitat does the wolf spider live in?"). Only avoid questions that ask the student to READ a visual detail the imageSpec does not define (e.g. who is speaking when the speakers aren't specified).
- Avoid negative questions ("Which direction does X NOT…", "Which is not…") unless exactly one option fits.
- For open-ended "why/explain" questions, give one concise model answer.

Pages:
${pageDescriptions}

Call the generate_page_content function with content for all pages.`

  let res
  try {
    res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: 8000,
      tool: contentTool,
      messages: [{ role: 'user', content: prompt }],
      label: 'Groq content',
      step: 'content',
    })
  } catch (err) {
    console.warn(`generateContent fetch failed (${err.status ?? err.message})`)
    return null
  }

  if (!res.args) {
    console.warn('generateContent: no tool call returned')
    return null
  }
  return res.args
}

/**
 * Schema-level checks on generated content. Returns an array of issue strings
 * (empty = valid). Exported for unit testing.
 */
export function validateSchema(contentData, contentPages, packageType = 'small') {
  const minQ = packageType === 'large' ? 5 : 4
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
    if (content.questions.length < minQ) {
      issues.push(`page ${page.pageNum} has only ${content.questions.length} questions (min ${minQ})`)
    }
    for (const q of content.questions) {
      if (!q.question?.trim()) issues.push(`page ${page.pageNum} q${q.num} empty question`)
      if (!q.answer?.trim()) issues.push(`page ${page.pageNum} q${q.num} empty answer`)
    }
    if (content.chart) {
      for (const issue of validateChart(content.chart)) issues.push(`page ${page.pageNum} ${issue}`)
    }
  }

  return issues
}

// A rewrite that turns a question into one about where something sits on the
// page ("Which habitat is listed second on the right side?") tests nothing; the
// recheck kept producing these for matching pages despite the prompt rule.
const LAYOUT_QUESTION = /\b(listed|shown|appears?|placed|located)\b[^?]*\b(first|second|third|fourth|fifth|last|top|bottom)\b|\b(left|right)[\s-](side|column)\b|\b(top|bottom) of the (page|column|list)\b/i

/** True if a rewritten question only asks about page layout/position. Pure — exported for unit testing. */
export function isLayoutQuestion(question) {
  return LAYOUT_QUESTION.test(question ?? '')
}

export async function validateAndCorrect(plan, contentData) {
  const prompt = `You are an academic fact-checker for elementary school worksheets.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Review every question and answer below. For each item check ALL of:
1. The answer is academically correct (math calculations, spelling, grammar, facts, logic)
2. The answer actually and specifically answers its question — not just correct in isolation
3. If the question asks the student to READ data from the picture (counts, chart/table values, labels), its answer must match the exact data in the page's chart (categories/values) or imageSpec (e.g. if the chart says Bananas=7, "how many bananas?" must be 7). Questions answered from subject knowledge — e.g. a matching page asking which habitat a spider lives in — do NOT need to be derivable from the imageSpec; only check that the answer is correct.
4. The question is appropriate in difficulty for ${plan.gradeLevel} level
5. The question has exactly ONE correct answer. Flag opinion/guessing questions ("who is likely…", "what do you think…"), questions that ask the student to read a visual detail the imageSpec doesn't define, and negative questions with several valid answers (e.g. "Which direction does Alex NOT patrol?" when three directions fit). Knowledge questions whose answer comes from the subject matter rather than the picture are FINE (e.g. a matching page "Which habitat matches the wolf spider?") — do not flag them.
6. If the answer is wrong, mismatched, or inappropriate, provide correctedAnswer.
7. If the QUESTION itself fails check 5, rewrite it as correctedQuestion (same skill, topic and difficulty, one verifiable answer) and give its correctedAnswer. Never answer an ambiguous question with "not specified" or "it depends" — rewrite the question instead. Never rewrite a question into one about layout or position on the page (e.g. "Is X shown at the top of the column?").
8. The picture is drawn from each page's imageSpec and printed on the student page, so a question may only quote or name what the imageSpec prints. If you rewrite a question or change an answer so that it depends on a quote, label, name or number that the imageSpec does not contain, ALSO return the page's complete corrected imageSpec in imageSpecCorrections. On matching pages every left-column item must have its correct match in the right column (e.g. if a quote's speaker is not among the listed figures, replace the quote in the imageSpec and the question together).
9. Check the attribution of every quotation. If you are not certain who said it, replace it with a well-documented quotation by one of the listed figures (and update the imageSpec to match).

${JSON.stringify(contentData.pages, null, 2)}

Call the validate_content function with your assessment.`

  let res
  try {
    res = await callTool(groq(), {
      model: MODELS.content,
      // gpt-oss is a reasoning model: reasoning tokens count toward this. A 59-question
      // small set used ~3.5k (3k reasoning); 2048 ran out and Groq returned 400 tool_use_failed.
      maxTokens: 8192,
      tool: validateTool,
      messages: [{ role: 'user', content: prompt }],
      label: 'Groq validate',
      step: 'content_recheck',
    })
  } catch (err) {
    console.warn(`validateAndCorrect failed (${err.status ?? err.message}) — using content as-is`)
    addReviewNote('fallback', `Q&A recheck failed (${err.status ?? err.message}) — answers were not double-checked`)
    return contentData
  }

  if (!res.args) return contentData
  return applyRecheck(contentData, res.args)
}

/**
 * Apply the recheck's corrections to the generated content. Corrections are
 * applied even if the model also said pass:true. A rewrite that quotes text the
 * page's imageSpec doesn't print is reverted unless the recheck also supplied a
 * corrected imageSpec — otherwise the picture and the questions disagree.
 * Pure apart from console/review-note logging — exported for unit testing.
 */
export function applyRecheck(contentData, validation) {
  const corrections = validation?.corrections ?? []
  const specFixes = new Map((validation?.imageSpecCorrections ?? []).map(f => [f.pageNum, f]))
  if (!corrections.length && !specFixes.size) return contentData

  console.log(`Content accuracy: ${corrections.length} correction(s) applied`)

  const correctionMap = new Map(corrections.map(c => [`${c.pageNum}-${c.questionNum}`, c]))

  const correctedPages = contentData.pages.map(page => {
    const specFix = specFixes.get(page.pageNum)
    const candidateSpec = specFix?.correctedImageSpec?.trim() ? specFix.correctedImageSpec : page.imageSpec

    // Apply the question corrections against a given spec; pure so it can be redone.
    const build = (imageSpec) => {
      const notes = []
      const questions = page.questions.map(q => {
        const fix = correctionMap.get(`${page.pageNum}-${q.num}`)
        if (!fix) return q
        if (fix.correctedQuestion && isLayoutQuestion(fix.correctedQuestion)) {
          console.warn(`  p${page.pageNum} q${q.num}: ignored layout-only rewrite "${fix.correctedQuestion}" — keeping the original question`)
          return q
        }
        const rewritten = { ...q, question: fix.correctedQuestion || q.question, answer: fix.correctedAnswer }
        if (fix.correctedQuestion && quotesMissingFromSpec(imageSpec, [rewritten]).length) {
          console.warn(`  p${page.pageNum} q${q.num}: rewrite quotes text the image spec lacks — keeping the original question`)
          notes.push(['spec_mismatch', `p${page.pageNum} q${q.num}: the recheck's rewrite cites a quote the picture would not show, so the original was kept — check this question's answer: "${q.question}"`])
          return q
        }
        if (fix.correctedQuestion) console.log(`  p${page.pageNum} q${q.num} question: "${q.question}" → "${fix.correctedQuestion}"`)
        console.log(`  p${page.pageNum} q${q.num}: "${q.answer}" → "${fix.correctedAnswer}" (${fix.reason})`)
        if (fix.correctedQuestion) {
          notes.push(['question_rewritten', `p${page.pageNum} q${q.num}: "${q.question}" → "${fix.correctedQuestion}" (answer: ${fix.correctedAnswer})`])
        } else if (fix.correctedAnswer !== q.answer) {
          notes.push(['answer_corrected', `p${page.pageNum} q${q.num} "${q.question}": ${q.answer} → ${fix.correctedAnswer}`])
        }
        return rewritten
      })
      return { questions, notes }
    }

    let imageSpec = candidateSpec
    let built = build(imageSpec)
    // A corrected spec that drops a quote some question still cites leaves the page
    // inconsistent — fall back to the original spec and the questions that fit it.
    if (imageSpec !== page.imageSpec && quotesMissingFromSpec(imageSpec, built.questions).length) {
      console.warn(`  p${page.pageNum}: corrected imageSpec drops a quote a question still cites — keeping the original imageSpec`)
      addReviewNote('spec_mismatch', `p${page.pageNum}: the recheck's image spec change left a question citing a quote the picture would not show, so the original image spec was kept — verify this page`)
      imageSpec = page.imageSpec
      built = build(imageSpec)
    }
    if (imageSpec !== page.imageSpec) {
      console.log(`  p${page.pageNum} imageSpec updated (${specFix.reason})`)
      addReviewNote('image_spec_updated', `p${page.pageNum}: image spec rewritten to match corrected questions (${specFix.reason})`)
    }
    built.notes.forEach(([kind, message]) => addReviewNote(kind, message))

    return { ...page, imageSpec, questions: built.questions }
  })

  return { ...contentData, pages: correctedPages }
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Remove answers that leaked into an imageSpec, since the image prints the spec
 * verbatim on the STUDENT page: "= <answer>" after an equation ("1×2 = 2" ->
 * "1×2") and "– <word answer>" after a clue ("Silk producer – SPIN"). Numeric
 * answers are only stripped after "=", so data like "Monday – 4 acorns" stays.
 * Mutates and returns contentData; logs each strip. Pure otherwise — exported
 * for unit testing.
 */
export function stripAnswerLeaks(contentData) {
  for (const page of contentData?.pages ?? []) {
    if (!page.imageSpec) continue
    let spec = page.imageSpec
    for (const { answer } of page.questions ?? []) {
      const a = String(answer ?? '').trim()
      if (!a) continue
      spec = spec.replace(new RegExp(`\\s*=\\s*${escapeRegExp(a)}(?!\\w|\\.\\d)`, 'g'), '')
      if (a.length >= 3 && Number.isNaN(Number(a))) {
        spec = spec.replace(new RegExp(`\\s*[–—-]\\s*${escapeRegExp(a)}(?![\\w])`, 'gi'), '')
      }
    }
    if (spec !== page.imageSpec) {
      console.warn(`p${page.pageNum}: removed answers from imageSpec`)
      addReviewNote('answer_leak', `p${page.pageNum}: removed answers from the image spec — confirm none are printed on the page`)
      page.imageSpec = spec
    }
  }
  return contentData
}

/**
 * Generate every worksheet/activity page's Q&A + imageSpec on Groq, recheck it,
 * and attach it to the plan. Essential: brainstorm no longer writes questions,
 * so if Groq returns nothing after all attempts the run fails rather than
 * shipping pages without content.
 */
export async function generateContent(plan) {
  const contentPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  if (contentPages.length === 0) return plan

  const MAX_RETRIES = 2
  let contentData = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    contentData = await fetchContent(plan, contentPages)
    if (!contentData) {
      if (attempt <= MAX_RETRIES) continue
      throw new Error(`Q&A generation failed after ${MAX_RETRIES + 1} attempts — see "generateContent" warnings above`)
    }

    const schemaIssues = validateSchema(contentData, contentPages, plan.packageType)
    if (schemaIssues.length > 0) {
      console.warn(`generateContent schema (attempt ${attempt}/${MAX_RETRIES + 1}): ${schemaIssues.join(', ')}`)
      if (attempt <= MAX_RETRIES) continue
      console.warn('generateContent: schema still invalid after retries — using best available content')
      addReviewNote('fallback', `Q&A content still had schema issues after retries: ${schemaIssues.join(', ')}`)
    }

    contentData = stripAnswerLeaks(await validateAndCorrect(plan, contentData))
    break
  }

  const slug = slugify(plan.setTitle)
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
