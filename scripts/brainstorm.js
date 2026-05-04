import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const TPT_SUBJECT_AREAS = [
  // Art
  'Art', 'Art History', 'Coloring Pages', 'Graphic Arts', 'Visual Arts', 'Other (Arts)',
  // English Language Arts
  'English Language Arts', 'Alphabet', 'Balanced Literacy', 'Close Reading', 'Creative Writing', 'ELA Test Prep',
  'Grammar', 'Handwriting', 'Informational Text', 'Library Skills', 'Literature',
  'Novel Studies', 'Phonics & Phonological Awareness', 'Poetry', 'Reading',
  'Reading Strategies', 'Science of Reading', 'Short Stories', 'Sight Words',
  'Spelling', 'Vocabulary', 'Writing', 'Writing-Essays', 'Writing-Expository', 'Other (ELA)',
  // Health
  'Health',
  // Math
  'Math', 'Algebra', 'Algebra 2', 'Applied Math', 'Arithmetic', 'Basic Operations', 'Calculus',
  'Decimals', 'Financial Literacy', 'Fractions', 'Geometry', 'Graphing', 'Math Test Prep',
  'Measurement', 'Mental Math', 'Money Math', 'Numbers', 'Order of Operations',
  'Place Value', 'PreCalculus', 'Statistics', 'Telling Time', 'Other (Math)',
  // Performing Arts
  'Performing Arts', 'Dance', 'Drama', 'Instrumental Music', 'Music', 'Music Composition', 'Vocal Music',
  'Other (Performing Arts)',
  // Physical Education
  'Physical Education',
  // Science
  'Science', 'Anatomy', 'Archaeology', 'Astronomy', 'Basic Principles', 'Biology', 'Chemistry',
  'Computer Science - Technology', 'Earth Sciences', 'Engineering', 'Environment',
  'Family Consumer Sciences', 'Forensics', 'General Science', 'Instructional Technology',
  'Marine Science', 'Physical Science', 'Physics', 'Robotics', 'Other (Science)',
  // Social Emotional
  'Social Emotional', 'Character Education', 'Classroom Community', 'School Counseling', 'School Psychology',
  'Social Emotional Learning',
  // Social Studies
  'Social Studies', 'AAPI History', 'African History', 'Ancient History', 'Asian Studies', 'Australian History',
  'Black History', 'British History', 'Business', 'Canadian History', 'Civics',
  'Criminal Justice - Law', 'Economics', 'Elections - Voting', 'European History',
  'Geography', 'Government', 'Latino and Hispanic Studies', 'Middle Ages', 'Native Americans',
  'Psychology', 'Religion', 'U.S. History', 'World History', 'Other (Social Studies)',
  // Speaking & Listening
  'Speaking & Listening',
  // World Languages
  'World Languages', 'American Sign Language', 'Arabic', 'Chinese', 'French', 'Gaeilge', 'German', 'Hebrew',
  'Italian', 'Japanese', 'Latin', 'Portuguese', 'Russian', 'Spanish', 'Other (World Language)',
  // Cross-subject
  'For All Subjects', 'Not Subject Specific',
]

const TPT_TAGS = [
  // Audience
  'Homeschool', 'Parents', 'Staff & Administrators', 'TPT Sellers',
  // Language
  'En español', 'En français', 'English (UK)',
  // Programs & Methods
  'Advanced Placement (AP)', 'Early Intervention', 'GATE / Gifted and Talented',
  'International Baccalaureate (IB)', 'Montessori',
  // Resource Type — Classroom Decor
  'Bulletin Board Ideas', 'Posters', 'Word Walls',
  // Resource Type — Clip Art
  'Clip Art',
  // Resource Type — Forms
  'Classroom Forms', 'Elective Course Proposals', 'Grant Proposals',
  'Professional Documents', 'School Nurse Documents', 'Student Council',
  // Resource Type — Hands-on Activities
  'Activities', 'Bell Ringers', 'Centers', 'Cultural Activities', 'DBQs',
  'Escape Rooms', 'Games', 'Internet Activities', 'Laboratory', 'Literature Circles',
  'Project-based Learning', 'Projects', 'Research', 'Scripts', 'Simulations',
  'Songs', 'Webquests',
  // Resource Type — Instruction
  'Bibliographies', 'Guided Reading Books', 'Handouts', 'Interactive Notebooks',
  'Scaffolded Notes', 'Printables',
  // Resource Type — Student Assessment
  'Assessment', 'Critical Thinking and Problem Solving', 'Study Guides',
  'Study Skills', 'Test Preparation',
  // Resource Type — Student Practice
  'Flash Cards', 'Graphic Organizers', 'Homework', 'Independent Work Packet',
  'Movie Guides', 'Task Cards', 'Workbooks', 'Worksheets',
  // Resource Type — Teacher Tools
  'Awards and Certificates', 'Classroom Management', 'Homeschool Curricula',
  'Leadership Lessons', 'Lectures', 'Lessons', 'Outlines',
  'Reflective Journals for Teachers', 'Rubrics', 'Syllabi', 'Teacher Manuals',
  'Teacher Planners', 'Thematic Unit Plans', 'Tools for Common Core',
  'Tools for Sellers', 'Unit Plans', 'Yearlong Curriculum',
  // Supports
  'ESL, EFL, and ELL',
  'Applied Behavior Analysis', 'Data', 'Life Skills', 'Neurodiversity',
  'Screenings and Assessments', 'Social Skills', 'Visual Supports', 'Other (Special education)',
  'Career and Technical Education', 'Child Care', 'Coaching', 'Cooking', 'Leadership',
  'Occupational Therapy', 'Physical Therapy', 'Professional Development',
  'Service Learning', 'Vocational Education', 'Other (Specialty)',
  'AAC', 'Fluency and Stuttering', 'Language', 'Speech Articulation', 'Voice',
  'Other (Speech therapy)',
  // Theme — Holiday
  "AAPI History Month", "April Fools' Day", 'Arbor Day', 'Black History Month',
  'Christmas-Chanukah-Kwanzaa', 'Cinco de Mayo', 'Day of the Dead / Dia de los Muertos',
  'Diwali', 'Earth Day', 'Easter', "Father's Day", 'Groundhog Day', 'Halloween',
  'Hispanic Heritage Month', 'July 4/Independence Day', 'Juneteenth', 'Labor Day',
  'Lunar New Year', 'Mardi Gras', 'Martin Luther King Day', 'Memorial Day',
  "Mother's Day", 'New Year', 'Passover', "Presidents' Day", 'Ramadan',
  "St. Patrick's Day", 'Thanksgiving', "Valentine's Day", 'Veterans Day',
  "Women's History Month",
  // Theme — Seasonal
  'Autumn', 'Back to School', 'End of Year', 'Spring', 'Summer', 'Winter',
]

const PAGE_RANGES = {
  free:  { min: 3,  max: 8  },
  small: { min: 10, max: 20 },
  large: { min: 20, max: null }, // max = maxPages from env
}

export async function brainstorm(gradeLevel, maxPages, history = [], packageType = 'small') {
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

  const subjectList = TPT_SUBJECT_AREAS.join(', ')
  const tagList = TPT_TAGS.join(', ')

  const range = PAGE_RANGES[packageType]
  const pageMax = packageType === 'large' ? maxPages : range.max

  const step2 = {
    free: `Step 2: Pick the single best topic. Create a FREE standalone worksheet set — ${range.min}–${range.max} pages including a cover (type "cover"), 1–6 worksheet/activity pages, and an answer key (type "answer_key") as the last page. Keep it self-contained. This is a lead-magnet to attract buyers to paid products.`,
    small: `Step 2: Pick the single best topic (highest sellability + grade-appropriateness + originality).
Plan a small worksheet packet — ${range.min}–${range.max} pages including a cover (type "cover"), multiple worksheets/activities, and an answer key (type "answer_key") as the last page.`,
    large: `Step 2: Pick the single best topic (highest sellability + grade-appropriateness + originality).
Plan a comprehensive worksheet unit — ${range.min}–${pageMax} pages including a cover (type "cover"), diverse worksheets and activities (different types: practice, application, challenge), and an answer key (type "answer_key") as the last page. Aim for depth and variety.`,
  }[packageType]

  const priceInstruction = {
    free:  `suggestedPrice MUST be 0.`,
    small: `suggestedPrice: realistic TPT price for a small packet (e.g. 2.00–5.00).`,
    large: `suggestedPrice: realistic TPT price for a comprehensive unit (e.g. 5.00–15.00).`,
  }[packageType]

  const descriptionInstruction = {
    free:  `2-3 sentences mentioning this is a FREE sample worksheet set.`,
    small: `2-3 sentences describing this small worksheet packet for TPT.`,
    large: `2-3 sentences describing this comprehensive worksheet unit for TPT, emphasising depth and variety.`,
  }[packageType]

  const prompt = `You are a curriculum designer for Teachers Pay Teachers (TPT).
${historyBlock}
Step 1: Generate 3 candidate printable worksheet topics ${gradeInstruction}.
For each include: title, subject, gradeLevel (specific, e.g. "Grade 2"), learningObjective, sellabilityScore (1-10), reason.
Pick topics that are DIFFERENT from the previously generated list above.

${step2}

Step 3: For the tptListing, pick 1–3 subjectAreas from this exact list ONLY (use exact strings):
${subjectList}

Step 4: For tptListing.tags, pick 1–6 tags from this exact list ONLY (use exact strings):
${tagList}

Step 5: Estimate teachingDuration in minutes (e.g. "30 minutes", "45-60 minutes") based on page count and activity complexity.

Rules for tptListing fields:
- description: ${descriptionInstruction}
- suggestedPrice: ${priceInstruction}

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
    "description": "string",
    "keywords": ["string"],
    "suggestedPrice": number,
    "subjectAreas": ["string (1–3 items, exact values from the allowed list above)"],
    "tags": ["string (1–6 items, exact values from the allowed list above)"],
    "teachingDuration": "string (e.g. '30 minutes', '45-60 minutes')"
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

  validate(plan, maxPages, packageType)
  if (packageType === 'free') plan.tptListing.suggestedPrice = 0

  // Filter out any invalid values Gemini hallucinated
  plan.tptListing.subjectAreas = plan.tptListing.subjectAreas.filter(a => TPT_SUBJECT_AREAS.includes(a))
  plan.tptListing.tags = plan.tptListing.tags.filter(t => TPT_TAGS.includes(t))

  return plan
}

function validate(plan, maxPages, packageType) {
  if (!plan.setTitle) throw new Error('Missing setTitle')
  if (!Array.isArray(plan.pages) || plan.pages.length < 2)
    throw new Error('pages array must have at least 2 items')
  const range = PAGE_RANGES[packageType]
  const pageMax = packageType === 'large' ? maxPages : range.max
  const count = plan.pages.length
  if (count < range.min || count > pageMax)
    throw new Error(`pageCount ${count} out of range for ${packageType} (${range.min}–${pageMax})`)
  if (plan.pages.at(-1).type !== 'answer_key')
    throw new Error('Last page must be answer_key')
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
