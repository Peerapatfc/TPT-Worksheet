import { openai } from '../llm/clients.js'
import { withRetry } from '../llm/with-retry.js'
import { MODELS, PAGE_RANGES } from '../config/constants.js'
import { TPT_SUBJECT_AREAS, TPT_TAGS } from '../config/tpt-taxonomy.js'
import { worksheetPlanTool } from './schema/worksheet-plan.js'

/**
 * Largest even worksheet count N that keeps total pages (1 + N + ceil(N/2))
 * within `pageMax`. Extracted for unit testing.
 * @param {number} pageMax
 * @returns {number}
 */
export function largestEvenN(pageMax) {
  const n = Math.floor((pageMax - 1) / 1.5)
  return n % 2 === 0 ? n : n - 1
}

/**
 * Pick a topic and plan a full worksheet set in a single forced tool call.
 * Retries up to MAX_RETRIES times, feeding validation errors back to the model.
 */
export async function brainstorm(gradeLevel, maxPages, history = [], packageType = 'small', currentMonth = '') {
  const historyBlock =
    history.length > 0
      ? `\nPREVIOUSLY GENERATED TOPICS — do NOT repeat or create anything similar in subject, title, or keywords:\n${history
          .map(h => `- "${h.setTitle}" (${h.subject}, ${h.date})${h.keywords?.length ? ` [${h.keywords.slice(0, 5).join(', ')}]` : ''}`)
          .join('\n')}\n`
      : ''

  const gradeInstruction = gradeLevel
    ? `for ${gradeLevel} students${gradeLevel.includes('-') ? ' — pick the single most appropriate specific grade within this range' : ''}`
    : 'for any grade level from Kindergarten to Grade 6 — pick the grade that best fits the topic and has the highest sellability'

  const subjectList = TPT_SUBJECT_AREAS.join(', ')
  const tagList = TPT_TAGS.join(', ')

  const range = PAGE_RANGES[packageType]
  const pageMax = packageType === 'large' ? maxPages : range.max

  const largeMaxNEven = largestEvenN(pageMax)
  const nOptions = {
    free:  'N = 5 or 6 (total pages: 9 or 10)',
    small: 'N = 10, 11, or 12 worksheets',
    large: `N = 14 to ${largeMaxNEven} worksheets — MINIMUM is 14, fewer will be rejected`,
  }[packageType]

  const step2 = {
    free: `Step 2: Pick the single best topic. Create a standalone worksheet set with EXACTLY this structure:
- 1 cover page (type "cover")
- N worksheet/activity pages
- ceil(N/2) answer_key pages at the end — each covers 2 consecutive worksheets (last may cover 1 if N is odd)
Valid values: ${nOptions}
Each answer_key MUST have sourcePageNums set to an array of the 1–2 pageNums it answers (e.g. [2,3] or [4]).`,
    small: `Step 2: Pick the single best topic (highest sellability + grade-appropriateness + originality). Use EXACTLY this structure:
- 1 cover page (type "cover")
- N worksheet/activity pages
- ceil(N/2) answer_key pages at the end — each covers 2 consecutive worksheets (last may cover 1 if N is odd)
Valid values: ${nOptions}
Each answer_key MUST have sourcePageNums set to an array of the 1–2 pageNums it answers (e.g. [2,3] or [4]).`,
    large: `Step 2: Pick the single best topic (highest sellability + grade-appropriateness + originality). Use EXACTLY this structure:
- 1 cover page (type "cover")
- N diverse worksheet/activity pages (practice, application, challenge)
- ceil(N/2) answer_key pages at the end — each covers 2 consecutive worksheets (last may cover 1 if N is odd)
Valid values: ${nOptions}
Page count formula: total = 1 + N + ceil(N/2). Examples: N=14 → 22 pages, N=18 → 28 pages, N=22 → 34 pages.
CRITICAL: N must be at least 14. N=12 gives only 19 pages which will be REJECTED.
Each answer_key MUST have sourcePageNums set to an array of the 1–2 pageNums it answers (e.g. [2,3] or [4]).`,
  }[packageType]

  const priceInstruction = {
    free:  `suggestedPrice MUST be 0.`,
    small: `suggestedPrice: realistic TPT price for a small packet (e.g. 2.00–5.00).`,
    large: `suggestedPrice: realistic TPT price for a comprehensive unit (e.g. 5.00–15.00).`,
  }[packageType]

  const sorLanguage = `For ELA, Reading, Phonics, Sight Words, Balanced Literacy, or Science of Reading subjects: include the phrase "Science of Reading aligned" or "SOR-aligned" in sentence 1 or 2.`
  const seasonalLanguage = currentMonth ? `If this topic is seasonally relevant to ${currentMonth}: mention it naturally (e.g. "Perfect for ${currentMonth} centers" or "Great for ${currentMonth.toLowerCase()} practice").` : ''

  const descriptionInstruction = `Write a 5–7 sentence TPT product description in this exact order:
1. Hook: what skill/concept this helps students practice and why teachers will value it.
2. What's included: mention the total page count (from your plan), the number of no-prep worksheets/activity pages, and that answer keys are included for every page.
3. Who it's for and best use cases: grade level plus 3–4 ideal contexts (whole class, small groups, literacy/math centers, homework, morning work, sub plans, or intervention).
4. Ease of use: start with "Print and go — no prep needed." Add 1–2 specific use scenarios.
5. Skills covered: list 3–5 specific skills from the pages you planned, in natural sentence form.
6. Standards (conditional): if Math or ELA subject, write "Aligned to Common Core State Standards (CCSS)." If Science, write "Aligned to Next Generation Science Standards (NGSS)." Otherwise omit this sentence entirely.
7. Close: end with "Answer key included for all pages."
${sorLanguage}
${seasonalLanguage}`

  const seasonalContextBlock = currentMonth
    ? `Current month: ${currentMonth}. Favor topics that are seasonally relevant or timely for this month if a strong seasonal angle exists. If no strong seasonal angle, pick the best topic regardless of season.\n\n`
    : ''

  const prompt = `You are a curriculum designer for Teachers Pay Teachers (TPT).
${historyBlock}${seasonalContextBlock}Step 1: Generate 3 candidate printable worksheet topics ${gradeInstruction}.
For each include: title, subject, gradeLevel (specific, e.g. "Grade 2"), learningObjective, sellabilityScore (1-10), reason.
Pick topics that are DIFFERENT from the previously generated list above.

${step2}

Step 3: For the tptListing, pick 1–3 subjectAreas from this exact list ONLY (use exact strings):
${subjectList}

Step 4: For tptListing.tags, pick 2–6 tags from this exact list ONLY (use exact strings):
${tagList}
REQUIRED: "Printables" and "Worksheets" must always be included. Add seasonal tags (e.g. "Spring", "Back to School", "End of Year") when relevant to the topic.

Step 5: Estimate teachingDuration in minutes (e.g. "30 minutes", "45-60 minutes") based on page count and activity complexity.

Step 6: Pick a themeColor — one hex color code (e.g. "#1B4F8A", "#2E7D32", "#6A1B9A") that matches the topic's mood. Must be a dark, saturated color suitable for a professional worksheet border and header bar. This exact hex will be used on EVERY page of this set.

Step 7: For every worksheet and activity page, populate the "content" field:
- "questions": array of EVERY question/exercise on that page with its correct answer. Number them sequentially across ALL worksheet/activity pages (q1, q2, q3... continuing from page to page — do NOT restart at 1 per page).
- "imageSpec": if the page contains a picture graph, bar chart, tally chart, data table, or number line with specific values — describe the EXACT values (e.g. "picture graph: cats=5, dogs=8, fish=3"). Otherwise set null.
- cover and answer_key pages: set content to null.
The answer key image will be generated using ONLY these questions and answers — so they must be complete and correct.

Step 8: For educationStandards, pick 2–5 specific standard codes that this resource FULLY covers:
- Math or ELA subject → framework: "CCSS", codes using exact format:
  - Math: "CCSS.MATH.CONTENT.[K or 1-6].[DOMAIN].[CLUSTER].[STANDARD]" (e.g. "CCSS.MATH.CONTENT.3.OA.A.1")
  - ELA: "CCSS.ELA-LITERACY.[STRAND].[GRADE].[STANDARD]" (e.g. "CCSS.ELA-LITERACY.RL.3.1")
- Science subject → framework: "NGSS", codes using exact format: "[K or 1-6]-[DisciplineCode][Topic]-[N]" (e.g. "3-LS1-1", "K-ESS2-1")
- Any other subject → framework: null, codes: []
Rules: only codes the resource FULLY covers (no partial alignment). Grade must match the worksheet's gradeLevel. Max 5 codes.

Rules for tptListing fields:
- title: Follow this pattern: "{Topic} {Product Type} | {Grade Level} | {Key Differentiator}"
  • {Product Type}: use "Worksheets", "Activities Packet", "Unit", "Practice Pages", or "Activity Pack"
  • {Grade Level}: always include, e.g. "Grade 3" or "Grades 2–3"
  • {Key Differentiator}: always include "No Prep Printable"; for ELA/Reading/Phonics/Sight Words topics also add "SOR-Aligned"; for Math topics with CCSS also add "Common Core"
  • Front-load the most-searchable keyword (the main topic/skill name)
  • Keep the full title under 80 characters
  Examples: "CVC Word Families Worksheets | Kindergarten | No Prep SOR-Aligned Printable"
            "Multiplication Facts Practice | Grade 3 | No Prep Common Core Printable"
            "Community Helpers Activities Packet | Grade 1 | No Prep Printable"
- keywords: Aim for 10–15 keywords. Always include:
  • Format keywords: "no prep worksheets", "print and go", "printable worksheets", "no prep printable"
  • Grade+subject combos, e.g. "grade 3 math worksheets", "kindergarten reading activities"
  • Answer key: "worksheets with answer key"
  • For ELA/Reading/Phonics/Sight Words: "science of reading", "SOR aligned" (when relevant)
  • For Math with CCSS: "common core math", "common core worksheets"
  • Topic-specific skill/concept words${currentMonth ? `\n  • Seasonal (if topic suits ${currentMonth}): e.g. "${currentMonth.toLowerCase()} worksheets", "${currentMonth.toLowerCase()} activities"` : ''}
- description: ${descriptionInstruction}
- suggestedPrice: ${priceInstruction}

Call the generate_worksheet_plan function with the complete plan.`

  const MAX_RETRIES = 3
  let plan = null
  const messages = [{ role: 'user', content: prompt }]
  const client = openai()

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const result = await withRetry(() => client.chat.completions.create({
      model: MODELS.brainstorm,
      max_tokens: 4000,
      tools: [worksheetPlanTool],
      tool_choice: { type: 'function', function: { name: 'generate_worksheet_plan' } },
      messages,
    }), { label: 'OpenAI brainstorm' })

    const assistantMsg = result.choices[0].message
    const toolCall = assistantMsg.tool_calls?.[0]
    if (!toolCall) throw new Error('OpenAI did not return a tool call for generate_worksheet_plan')

    const candidate = JSON.parse(toolCall.function.arguments)

    try {
      validate(candidate, maxPages, packageType)
    } catch (err) {
      if (attempt <= MAX_RETRIES) {
        console.warn(`brainstorm validation (attempt ${attempt}/${MAX_RETRIES + 1}): ${err.message} — retrying`)
        messages.push(assistantMsg)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Validation failed: ${err.message}. Fix the issue and call generate_worksheet_plan again with a valid plan.`,
        })
        continue
      }
      throw err
    }

    plan = candidate
    break
  }

  if (packageType === 'free') plan.tptListing.suggestedPrice = 0

  plan.pageCount = plan.pages.length

  for (const p of plan.pages) {
    if (!p.filename.endsWith('.png')) p.filename = p.filename.replace(/\.[^.]+$/, '') + '.png'
  }

  plan.tptListing.subjectAreas = plan.tptListing.subjectAreas.filter(a => TPT_SUBJECT_AREAS.includes(a))
  plan.tptListing.tags = plan.tptListing.tags.filter(t => TPT_TAGS.includes(t))

  // Auto-assign sourcePageNums by position for any answer_key missing it
  const contentPages = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')
  plan.pages.filter(p => p.type === 'answer_key').forEach((ak, i) => {
    if (!ak.sourcePageNums?.length) {
      const pair = contentPages.slice(i * 2, i * 2 + 2).map(p => p.pageNum)
      ak.sourcePageNums = pair
      console.warn(`Auto-assigned sourcePageNums=${JSON.stringify(pair)} to answer_key p${ak.pageNum}`)
    }
  })

  plan.packageType = packageType
  return plan
}

/**
 * Validate a brainstorm candidate plan against structural and taxonomy rules.
 * Throws on the first hard failure; logs (non-fatal) for filterable issues.
 * Exported for unit testing.
 */
export function validate(plan, maxPages, packageType) {
  if (!plan.setTitle) throw new Error('Missing setTitle')
  if (!Array.isArray(plan.pages) || plan.pages.length < 2)
    throw new Error('pages array must have at least 2 items')
  const range = PAGE_RANGES[packageType]
  const pageMax = packageType === 'large' ? maxPages : range.max
  const count = plan.pages.length
  if (count < range.min || count > pageMax)
    throw new Error(`pageCount ${count} out of range for ${packageType} (${range.min}–${pageMax})`)
  const contentPageCount = plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity').length
  const akPages = plan.pages.filter(p => p.type === 'answer_key')
  if (akPages.length === 0) throw new Error('No answer_key pages found')
  const expectedAK = Math.ceil(contentPageCount / 2)
  if (akPages.length !== expectedAK)
    throw new Error(`answer_key count (${akPages.length}) must equal ceil(${contentPageCount}/2) = ${expectedAK}`)
  const firstAKIdx = plan.pages.findIndex(p => p.type === 'answer_key')
  const nonAKAfterFirst = plan.pages.slice(firstAKIdx).filter(p => p.type !== 'answer_key')
  if (nonAKAfterFirst.length > 0) throw new Error('All answer_key pages must be grouped at the end')
  if (!plan.tptListing?.title) throw new Error('Missing tptListing.title')
  const areas = plan.tptListing?.subjectAreas
  if (!Array.isArray(areas) || areas.length < 1)
    throw new Error('tptListing.subjectAreas must have at least 1 item')
  const invalidAreas = areas.filter(a => !TPT_SUBJECT_AREAS.includes(a))
  if (invalidAreas.length > 0) console.warn(`Filtering invalid subjectAreas: ${invalidAreas.join(', ')}`)
  const validAreas = areas.filter(a => TPT_SUBJECT_AREAS.includes(a))
  if (validAreas.length === 0) throw new Error('No valid subjectAreas after filtering')
  const tags = plan.tptListing?.tags
  if (!Array.isArray(tags) || tags.length < 1)
    throw new Error('tptListing.tags must have at least 1 item')
  const invalidTags = tags.filter(t => !TPT_TAGS.includes(t))
  if (invalidTags.length > 0) console.warn(`Filtering invalid tags: ${invalidTags.join(', ')}`)
  const validTags = tags.filter(t => TPT_TAGS.includes(t))
  if (validTags.length === 0) throw new Error('No valid tags after filtering')
  if (!plan.tptListing?.teachingDuration)
    throw new Error('Missing tptListing.teachingDuration')
}
