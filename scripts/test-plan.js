import 'dotenv/config'
import { brainstorm } from './brainstorm.js'
import { generateContent, validateAndCorrect } from './generate-content.js'
import { readTopicHistory } from './topic-history.js'

async function main() {
  const packageType = process.env.PACKAGE_TYPE ?? 'small'
  const gradeLevel = process.env.GRADE_LEVEL || null
  const maxPages = parseInt(process.env.MAX_PAGES_PER_SET ?? '30', 10)

  console.log(`\n[test-plan] package=${packageType} grade=${gradeLevel ?? 'any'} maxPages=${maxPages}`)

  const history = await readTopicHistory()
  console.log(`[test-plan] history: ${history.length} past topics`)

  console.log('\n--- BRAINSTORM ---')
  const plan = await brainstorm(gradeLevel, maxPages, history, packageType)

  console.log(`Title:    ${plan.setTitle}`)
  console.log(`Grade:    ${plan.gradeLevel}  Subject: ${plan.subject}`)
  console.log(`Pages:    ${plan.pageCount}   Price: $${plan.tptListing.suggestedPrice}`)
  console.log(`Duration: ${plan.tptListing.teachingDuration}`)
  console.log(`Tags:     ${plan.tptListing.tags.join(', ')}`)
  console.log('\nPage plan:')
  for (const p of plan.pages) {
    const extra = p.sourcePageNum ? ` → answers p${p.sourcePageNum}` : ''
    console.log(`  ${String(p.pageNum).padStart(2)}. [${p.type.padEnd(10)}] ${p.filename}${extra}`)
  }

  console.log('\n--- GENERATE CONTENT ---')
  const planWithContent = await generateContent(plan)

  let totalQ = 0
  for (const page of planWithContent.pages) {
    if (!page.content?.questions?.length) continue
    const qCount = page.content.questions.length
    totalQ += qCount
    console.log(`\nPage ${page.pageNum} (${page.type}) — ${qCount} questions${page.content.imageSpec ? ` | visual: ${page.content.imageSpec}` : ''}`)
    for (const q of page.content.questions) {
      console.log(`  Q${q.num}: ${q.question}`)
      console.log(`      → ${q.answer}`)
    }
  }

  // Build contentData shape for recheck
  const contentPages = planWithContent.pages.filter(p => p.content?.questions?.length > 0)
  const beforeMap = new Map(
    contentPages.flatMap(p => p.content.questions.map(q => [`${p.pageNum}-${q.num}`, q.answer]))
  )
  const contentData = {
    pages: contentPages.map(p => ({
      pageNum: p.pageNum,
      title: p.filename,
      imageSpec: p.content.imageSpec ?? '',
      questions: p.content.questions,
    })),
  }

  console.log('\n--- RECHECK Q&A ---')
  const rechecked = await validateAndCorrect(planWithContent, contentData)

  let passed = 0
  let corrected = 0
  for (const page of rechecked.pages) {
    for (const q of page.questions) {
      const before = beforeMap.get(`${page.pageNum}-${q.num}`)
      if (before !== q.answer) {
        console.log(`  FIXED  Q${q.num}: "${before}" → "${q.answer}"`)
        corrected++
      } else {
        passed++
      }
    }
  }
  console.log(`\nRecheck result: ${passed} correct, ${corrected} corrected out of ${passed + corrected} total`)

  const allQA = rechecked.pages.flatMap(p => p.questions)

  console.log(`\n--- ANSWER KEY PREVIEW (${allQA.length} items) ---`)
  for (const q of allQA) {
    console.log(`  ${q.num}. ${q.question} → ${q.answer}`)
  }

  console.log(`\n--- DONE ---`)
  console.log(`Total questions: ${totalQ}`)
  console.log(`Content log: logs/content-*.json`)
  console.log(`No images generated. No Drive upload. No Telegram. No Supabase write.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
