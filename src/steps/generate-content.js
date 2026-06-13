import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { groq } from '../llm/clients.js'
import { callTool } from '../llm/tool-call.js'
import { MODELS } from '../config/constants.js'
import { slugify } from '../lib/slugify.js'

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
              imageSpec: { type: 'string', description: 'Exact visual data spec, or empty string if no visualization' },
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
              reason: { type: 'string' },
            },
            required: ['pageNum', 'questionNum', 'correctedAnswer', 'reason'],
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
- Picture graphs: "Draw EXACTLY N [icon] icons for [category]" for every category
- Bar charts: list every bar label and exact height value
- Data tables: list every cell value
- Number sequences / patterns: list every term explicitly
- Matching activities (draw-a-line): list left column items top-to-bottom, then list right column items in a SHUFFLED order (NOT the same order as left column) so correct answers require diagonal or non-straight lines. Specify both columns explicitly: "Left (top to bottom): A, B, C, D. Right (top to bottom, shuffled): C, A, D, B."
AVOID visual types that AI cannot render accurately:
- Base-10 blocks with subdivisions (use text "3 tens 2 ones" format instead)
- Analog clocks with exact hand positions
- Protractors, rulers with exact measurements
- Geometric shapes requiring precise angles/dimensions
For pages with NO data visualization (pure text questions, writing prompts): set imageSpec to ""

STEP 2 — Generate Q&A from your imageSpec:
- Every answer must be derivable from the exact data in imageSpec
- ${plan.packageType === 'free' ? '4–5' : plan.packageType === 'large' ? '5–8' : '4–6'} questions per page, appropriate for ${plan.gradeLevel}
- For Math: use exact numbers from imageSpec. For ELA: clear sentence prompts. For Science/Social Studies: fact-based.
- All answers must be factually and academically correct.

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
  }

  return issues
}

export async function validateAndCorrect(plan, contentData) {
  const prompt = `You are an academic fact-checker for elementary school worksheets.

Set: "${plan.setTitle}" | Grade: ${plan.gradeLevel} | Subject: ${plan.subject}

Review every question and answer below. For each item check ALL of:
1. The answer is academically correct (math calculations, spelling, grammar, facts, logic)
2. The answer actually and specifically answers its question — not just correct in isolation
3. If the page has an imageSpec, the answer must be derivable from the exact data in that imageSpec (e.g. if imageSpec says Bananas=7, answer to "how many bananas?" must be 7)
4. The question is appropriate in difficulty for ${plan.gradeLevel} level
5. If wrong, mismatched, or inappropriate, provide the corrected answer

${JSON.stringify(contentData.pages, null, 2)}

Call the validate_content function with your assessment.`

  let res
  try {
    res = await callTool(groq(), {
      model: MODELS.content,
      maxTokens: 2048,
      tool: validateTool,
      messages: [{ role: 'user', content: prompt }],
      label: 'Groq validate',
    })
  } catch (err) {
    console.warn(`validateAndCorrect failed (${err.status ?? err.message}) — using content as-is`)
    return contentData
  }

  if (!res.args) return contentData
  const validation = res.args

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
  const contentPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  if (contentPages.length === 0) return plan

  const MAX_RETRIES = 2
  let contentData = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    contentData = await fetchContent(plan, contentPages)
    if (!contentData) return plan

    const schemaIssues = validateSchema(contentData, contentPages, plan.packageType)
    if (schemaIssues.length > 0) {
      console.warn(`generateContent schema (attempt ${attempt}/${MAX_RETRIES + 1}): ${schemaIssues.join(', ')}`)
      if (attempt <= MAX_RETRIES) continue
      console.warn('generateContent: schema still invalid after retries — using best available content')
    }

    contentData = await validateAndCorrect(plan, contentData)
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
