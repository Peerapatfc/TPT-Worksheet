import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export async function brainstorm(gradeLevel, maxPages, history = []) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.9,
    },
  })

  const historyBlock =
    history.length > 0
      ? `\nPREVIOUSLY GENERATED TOPICS — do NOT repeat or create anything similar in subject, title, or keywords:\n${history
          .map(h => `- "${h.setTitle}" (${h.subject}, ${h.date})${h.keywords?.length ? ` [${h.keywords.slice(0, 5).join(', ')}]` : ''}`)
          .join('\n')}\n`
      : ''

  const gradeInstruction = gradeLevel
    ? `for ${gradeLevel} students${gradeLevel.includes('-') ? ' — pick the single most appropriate specific grade within this range' : ''}`
    : 'for any grade level from Kindergarten to Grade 6 — pick the grade that best fits the topic and has the highest sellability'

  const prompt = `You are a curriculum designer for Teachers Pay Teachers (TPT).
${historyBlock}
Step 1: Generate 3 candidate printable worksheet SET topics ${gradeInstruction}.
For each include: title, subject, gradeLevel (specific, e.g. "Grade 2"), learningObjective, sellabilityScore (1-10), reason.
Pick topics that are DIFFERENT from the previously generated list above.

Step 2: Pick the single best topic (highest sellability + grade-appropriateness + originality).
Plan a complete worksheet set for it.
Decide how many pages are needed based on content (minimum 2, maximum ${maxPages}).
The last page MUST always be type "answer_key".

Return JSON matching this exact schema:
{
  "setTitle": "string",
  "subject": "string",
  "gradeLevel": "string",
  "pageCount": number,
  "pages": [
    {
      "pageNum": number,
      "type": "cover|worksheet|activity|answer_key",
      "filename": "page_N_type",
      "imagePrompt": "string (detailed visual description for image generation)"
    }
  ],
  "tptListing": {
    "title": "string (SEO-optimised, include grade + subject + keywords)",
    "description": "string (2-3 sentences for TPT product page)",
    "keywords": ["string"],
    "suggestedPrice": number
  }
}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text()

  let plan
  try {
    plan = JSON.parse(raw)
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 200)}`)
  }

  validate(plan, maxPages)
  return plan
}

function validate(plan, maxPages) {
  if (!plan.setTitle) throw new Error('Missing setTitle')
  if (!Array.isArray(plan.pages) || plan.pages.length < 2)
    throw new Error('pages array must have at least 2 items')
  if (plan.pages.length > maxPages)
    throw new Error(`pageCount ${plan.pages.length} exceeds MAX_PAGES_PER_SET ${maxPages}`)
  if (plan.pages.at(-1).type !== 'answer_key')
    throw new Error('Last page must be answer_key')
  if (!plan.tptListing?.title) throw new Error('Missing tptListing.title')
}
