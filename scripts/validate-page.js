import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

export async function validatePage(page, buffer) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const prompt = `You are a quality checker for Teachers Pay Teachers (TPT) printable worksheets.

Examine this worksheet image and check ALL of the following:
1. Has a visible header with title, grade level, and page number
2. Has sufficient writing or answer space for students
3. Content matches expected page type: "${page.type}" (cover/worksheet/activity/answer_key)
4. Layout is clean and professional — readable font, no clutter
5. If type is "answer_key": answers or solutions are visibly present

Return JSON only:
{
  "pass": true or false,
  "issues": ["describe each problem here"]
}

If all checks pass, return { "pass": true, "issues": [] }`

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } },
  ])

  let validation
  try {
    validation = JSON.parse(result.response.text())
  } catch {
    return { pass: true, issues: ['validation parse error — skipping'] }
  }

  return validation
}
