// Live regression eval for the LLM quality gates — run before changing a prompt.
// Calls the real models (needs OPENAI_API_KEY + GROQ_API_KEY in .env; ~$0.15 at
// the default 3 runs). Not part of `npm test`/CI.
//
//   npm run eval                 # all suites, 3 runs per case
//   EVAL_RUNS=5 npm run eval     # more runs for a noisier change
//   npm run eval -- validator    # one suite: validator | recheck
//
// Cases live in eval/cases.json (fixture images in eval/images, already
// downscaled to the validator's input size). A case passes when the majority of
// its runs give the expected verdict. `knownGap` cases are reported but never
// fail the eval. Exit code 1 if any other case fails.
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { validatePage } from '../src/steps/validate-page.js'
import { validateAndCorrect, isLayoutQuestion } from '../src/steps/generate-content.js'
import { costSummary } from '../src/lib/cost-tracker.js'

const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'eval')
const RUNS = Math.max(1, parseInt(process.env.EVAL_RUNS ?? '3', 10) || 3)
const only = process.argv[2]
const cases = JSON.parse(readFileSync(join(EVAL_DIR, 'cases.json'), 'utf8'))

// Silence the steps' own progress logs; keep warnings visible.
const log = console.log
console.log = () => {}

const results = []

async function runValidator() {
  for (const c of cases.validator) {
    const image = readFileSync(join(EVAL_DIR, c.image))
    const verdicts = []
    let lastIssues = []
    for (let r = 0; r < RUNS; r++) {
      const v = await validatePage(c.page, image, { setTitle: c.setTitle })
      verdicts.push(v.pass ? 'pass' : 'fail')
      if ((v.pass ? 'pass' : 'fail') !== c.expect) lastIssues = v.issues
    }
    record('validator', c, verdicts.filter(v => v === c.expect).length, verdicts.map(v => v[0].toUpperCase()).join(''), lastIssues)
  }
}

async function runRecheck() {
  for (const c of cases.recheck) {
    let correctRuns = 0
    let rewrites = 0
    const misses = new Set()
    for (let r = 0; r < RUNS; r++) {
      const input = structuredClone({ pages: c.pages })
      const out = await validateAndCorrect(c.plan, input)
      const before = new Map(c.pages.flatMap(p => p.questions.map(q => [`${p.pageNum}-${q.num}`, q.question])))
      const after = new Map(out.pages.flatMap(p => p.questions.map(q => [`${p.pageNum}-${q.num}`, q.question])))
      const changed = key => before.get(key) !== after.get(key)
      rewrites += c.expectNotLayout.filter(changed).length
      // Rewording a knowledge question is allowed; turning it into a question
      // about page layout ("listed second on the right side") is not.
      const runMisses = [
        ...c.expectNotLayout.filter(k => changed(k) && isLayoutQuestion(after.get(k))).map(k => `${k} became a layout question: "${after.get(k)}"`),
        ...c.expectRewritten.filter(k => !changed(k)).map(k => `${k} kept (should be rewritten)`),
      ]
      runMisses.forEach(m => misses.add(m))
      if (runMisses.length === 0) correctRuns++
    }
    record('recheck', c, correctRuns, `${correctRuns}/${RUNS}; knowledge questions reworded ${rewrites}x, allowed`, [...misses])
  }
}

function record(suite, c, correct, detail, issues) {
  const ok = correct * 2 > RUNS
  results.push({ suite, label: c.label, ok, flaky: ok && correct < RUNS, knownGap: c.knownGap, detail, issues })
}

if (!only || only === 'validator') await runValidator()
if (!only || only === 'recheck') await runRecheck()

console.log = log
for (const r of results) {
  const mark = r.ok ? '✓' : r.knownGap ? '○' : '✗'
  log(`${mark} [${r.suite}] ${r.label}  (${r.detail})`)
  if ((!r.ok || r.flaky) && r.issues.length) log(`    ${r.flaky ? 'flaky — ' : ''}${r.issues.join(' | ').slice(0, 300)}`)
  if (!r.ok && r.knownGap) log(`    known gap: ${r.knownGap}`)
}
const failed = results.filter(r => !r.ok && !r.knownGap)
const cost = costSummary()
log(`\n${results.length - failed.length}/${results.length} cases ok (${RUNS} runs each, majority vote) — API cost $${cost.totalUsd}`)
process.exit(failed.length ? 1 : 0)
