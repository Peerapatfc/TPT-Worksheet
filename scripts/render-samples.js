// Render one sample page per hybrid layout (test/fixtures/layout-samples.js) to PNG.
//   node scripts/render-samples.js [outDir] [--flux] [--only name,name]
// Without --flux a code-drawn stub picture is used (offline, free). With --flux the
// illustrations come from FLUX.1 schnell on Cloudflare Workers AI (free tier;
// needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN in .env). Never calls OpenAI.
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { samples } from '../test/fixtures/layout-samples.js'
import { stubIllustration } from '../test/helpers/stub-art.js'
import { renderHybridPage } from '../src/lib/hybrid-page.js'
import { createIllustrationProvider } from '../src/lib/illustrations.js'
import { validateLayoutSpec, layoutAnswerKey } from '../src/lib/layout/specs.js'

const args = process.argv.slice(2)
const flux = args.includes('--flux')
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null
const outDir = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only') ?? 'samples-out')
mkdirSync(outDir, { recursive: true })

const illustrations = flux
  ? createIllustrationProvider({ concurrency: 1 })
  : { get: async () => stubIllustration() }

for (const s of samples) {
  if (only && !only.includes(s.name)) continue
  const errs = validateLayoutSpec(s.layout, s.spec)
  if (errs.length) { console.error(`${s.name}: invalid spec: ${errs.join('; ')}`); continue }
  const { buffer, meta } = await renderHybridPage(s.plan, s.page, { layout: s.layout, spec: s.spec, illustrations })
  const file = path.join(outDir, `${s.name}${flux ? '-flux' : ''}.png`)
  writeFileSync(file, buffer)
  console.log(`${file}  ${JSON.stringify(meta)}`)
  for (const q of layoutAnswerKey(s.layout, s.spec)) console.log(`   key ${q.num}. ${q.question} → ${q.answer}`)
}
