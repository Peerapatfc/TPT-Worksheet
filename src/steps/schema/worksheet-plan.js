// OpenAI tool definition for the brainstorm step. Forcing this function call
// gives us a reliably-structured worksheet plan (parsed from function.arguments).

export const worksheetPlanTool = {
  type: 'function',
  function: {
    name: 'generate_worksheet_plan',
    description: 'Generate a complete TPT worksheet plan with pages, content, and listing metadata',
    parameters: {
      type: 'object',
      properties: {
        setTitle: { type: 'string' },
        subject: { type: 'string' },
        gradeLevel: { type: 'string' },
        themeColor: { type: 'string', description: 'Hex color code for border and header bar on all pages, e.g. "#1B4F8A". Must be dark and saturated.', pattern: '^#[0-9A-Fa-f]{6}$' },
        pageCount: { type: 'integer' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pageNum: { type: 'integer' },
              type: { type: 'string', enum: ['cover', 'worksheet', 'activity', 'answer_key'] },
              sourcePageNums: { type: 'array', items: { type: 'integer' }, description: 'answer_key pages only: exactly 2 pageNums of the worksheets this page answers' },
              filename: { type: 'string' },
              imagePrompt: { type: 'string' },
              content: {
                description: 'null for cover/answer_key pages. For worksheet/activity: include questions and optional imageSpec.',
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    properties: {
                      imageSpec: { type: ['string', 'null'], description: 'Exact visual data for charts/graphs, else null' },
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
                    required: ['questions'],
                  },
                ],
              },
            },
            required: ['pageNum', 'type', 'filename', 'imagePrompt'],
          },
        },
        tptListing: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Must follow pattern: "{Topic} {Product Type} | {Grade Level} | {Key Differentiator}". Product Type: Worksheets/Activities Packet/Practice Pages/Unit. Grade Level: e.g. "Grade 3" or "Grades 2–3". Key Differentiator: always "No Prep Printable"; add "SOR-Aligned" for ELA/Phonics/Reading; add "Common Core" for Math+CCSS. Front-load main keyword. Max 80 chars. Example: "Fractions Worksheets | Grade 3 | No Prep Common Core Printable"' },
            description: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' }, minItems: 10, maxItems: 15 },
            suggestedPrice: { type: 'number' },
            subjectAreas: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            teachingDuration: { type: 'string' },
          },
          required: ['title', 'description', 'keywords', 'suggestedPrice', 'subjectAreas', 'tags', 'teachingDuration'],
        },
        educationStandards: {
          type: 'object',
          properties: {
            framework: { type: ['string', 'null'], enum: ['CCSS', 'NGSS', null] },
            codes: { type: 'array', items: { type: 'string' }, description: 'Specific standard codes, max 5, only fully-covered standards' },
          },
          required: ['framework', 'codes'],
        },
      },
      required: ['setTitle', 'subject', 'gradeLevel', 'themeColor', 'pageCount', 'pages', 'tptListing', 'educationStandards'],
    },
  },
}
