// Live Groq-only eval of the hybrid content step (PAGE_RENDERER=hybrid): runs the
// structured content generation on the realistic plans in eval/hybrid-plans.js and
// reports, per layout, how often the first attempt validates, retries, picture-
// dependence rejections, fallbacks, tokens per call, 429/400 counts and wall time.
// Free (Groq free tier) — but mind the daily token budget: 200k tokens/day (TPD) for
// gpt-oss-120b, shared with the daily pipeline. One call is ~2.8k tokens and a run
// ~2–3 calls, so the default 6 plans × 3 runs needs ~120k; use EVAL_RUNS=1 first.
// Never calls OpenAI. Not part of `npm test`/CI.
//
//   npm run eval:hybrid                    # 6 plans × 3 runs
//   EVAL_RUNS=1 EVAL_PLANS=0,3 npm run eval:hybrid
//   EVAL_RECHECK=1 npm run eval:hybrid     # also run the structured recheck
//   npm run eval:hybrid -- out/dir         # also save every run's content JSON there
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { hybridPlans } from '../eval/hybrid-plans.js'
import { generateHybridPages, recheckHybridContent } from '../src/steps/hybrid-content.js'
import { suggestLayout } from '../src/steps/hybrid-content.js'
import { resetReviewNotes, reviewNotes } from '../src/lib/review-notes.js'

const RUNS = Math.max(1, parseInt(process.env.EVAL_RUNS ?? '3', 10) || 3)
const planIdx = process.env.EVAL_PLANS ? process.env.EVAL_PLANS.split(',').map(Number) : hybridPlans.map((_, i) => i)
const outDir = process.argv[2] ? resolve(process.argv[2]) : null
if (outDir) mkdirSync(outDir, { recursive: true })

let status429 = 0
const warn = console.warn
console.warn = (...a) => { if (/\b429\b/.test(String(a[0]))) status429++; warn(...a) }
const log = console.log
console.log = () => {}

const byLayout = new Map()
const row = (l) => { if (!byLayout.has(l)) byLayout.set(l, { pages: 0, first: 0, retried: 0, fallbackQ: 0, legacy: 0, picture: 0, suggested: 0 }); return byLayout.get(l) }
const calls = []
const t0 = Date.now()

for (const pi of planIdx) {
  const plan = hybridPlans[pi]
  for (let r = 0; r < RUNS; r++) {
    resetReviewNotes()
    const stats = { calls: [], pages: [] }
    const started = Date.now()
    const { pages, failed } = await generateHybridPages(plan, plan.pages, { stats })
    let structured = [...pages].map(([pageNum, v]) => ({ pageNum, content: v.content, fallback: v.fallback }))
    if (process.env.EVAL_RECHECK === '1') structured = await recheckHybridContent(plan, structured)
    calls.push(...stats.calls)
    for (const p of plan.pages) {
      const tries = stats.pages.filter(x => x.pageNum === p.pageNum)
      const firstLayout = tries[0]?.layout ?? 'missing'
      const st = row(firstLayout)
      st.pages++
      if (firstLayout === suggestLayout(p)) st.suggested++
      if (tries[0] && tries[0].issues.length === 0) st.first++
      else st.retried++
      if (tries.some(t => t.issues.some(i => /depends on the picture/.test(i)))) st.picture++
      if (pages.get(p.pageNum)?.fallback) st.fallbackQ++
      if (failed.some(f => f.pageNum === p.pageNum)) st.legacy++
      for (const t of tries) if (t.issues.length) warn(`  [${plan.setTitle} r${r + 1}] p${p.pageNum} ${t.layout} attempt ${t.attempt}: ${t.issues.join('; ').slice(0, 300)}`)
    }
    log(`${plan.setTitle} run ${r + 1}: ${((Date.now() - started) / 1000).toFixed(0)}s, ${stats.calls.length} call(s), layouts ${structured.map(p => `${p.pageNum}:${p.content.layout}`).join(' ')}${failed.length ? `, legacy ${failed.map(f => f.pageNum).join(',')}` : ''}${reviewNotes().length ? `, notes ${reviewNotes().length}` : ''}`)
    if (outDir) writeFileSync(join(outDir, `plan${pi}-run${r + 1}.json`), JSON.stringify({ plan, pages: structured, failed: failed.map(f => f.pageNum), notes: reviewNotes() }, null, 2))
  }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–')
log('\nlayout (first attempt) | pages | first-pass valid | retried | picture-dep. rejects | → questions fallback | → legacy | = suggested')
let tot = { pages: 0, first: 0, retried: 0, fallbackQ: 0, legacy: 0, picture: 0 }
for (const [l, st] of [...byLayout].sort()) {
  log(`${l.padEnd(16)} | ${String(st.pages).padStart(3)} | ${pct(st.first, st.pages).padStart(4)} | ${String(st.retried).padStart(3)} | ${String(st.picture).padStart(3)} | ${String(st.fallbackQ).padStart(3)} | ${String(st.legacy).padStart(3)} | ${pct(st.suggested, st.pages)}`)
  for (const k of Object.keys(tot)) tot[k] += st[k]
}
log(`TOTAL            | ${tot.pages} | ${pct(tot.first, tot.pages)} | ${tot.retried} | ${tot.picture} | ${tot.fallbackQ} | ${tot.legacy}`)
const ok = calls.filter(c => c.usage)
const avg = (f) => (ok.length ? Math.round(ok.reduce((s, c) => s + f(c), 0) / ok.length) : 0)
const errors = calls.filter(c => c.error)
log(`\ncalls ${calls.length} (failed ${errors.length}: ${errors.map(e => `${e.error}${e.code ? `/${e.code}` : ''}`).join(', ') || 'none'}), 429 retries ${status429}`)
log(`tokens/call avg: prompt ${avg(c => c.usage.prompt_tokens)}, completion ${avg(c => c.usage.completion_tokens)}, total ${avg(c => c.usage.total_tokens)}; max total ${Math.max(0, ...ok.map(c => c.usage.total_tokens))}`)
log(`wall time ${((Date.now() - t0) / 1000).toFixed(0)}s for ${planIdx.length} plan(s) × ${RUNS} run(s)`)
