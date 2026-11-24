import sharp from 'sharp'
import { openai } from '../llm/clients.js'
import { withRetry } from '../llm/with-retry.js'
import { MODELS, IMAGE_SIZE } from '../config/constants.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { recordUsage } from '../lib/cost-tracker.js'
import { addReviewNote } from '../lib/review-notes.js'
import { answerKeySvg, renderSvg } from '../lib/svg-templates.js'
import { chartPageSvg, validateChart } from '../lib/chart-page.js'
import { useHybridCover, renderHybridCover } from '../lib/hybrid-cover.js'
import { pageRenderer, renderHybridPage } from '../lib/hybrid-page.js'
import { classifyHybridLayout } from '../lib/layout/classify.js'
import { LayoutOverflowError } from '../lib/layout/measure.js'
import { createIllustrationProvider } from '../lib/illustrations.js'
import { readConcurrency } from '../lib/concurrency.js'
import { validatePage } from './validate-page.js'
import { reconcilePageContent } from './reconcile-content.js'

const MAX_ATTEMPTS = 3

const BASE_STYLE = {
  cover:   'Square format, professional educator resource cover. Clean bold typography. Colorful and engaging design. NO questions, NO lines, NO answer spaces.',
  default: 'Portrait orientation, A4 printable worksheet. Clean sans-serif font. Colorful and engaging design. Professional TPT layout.',
}

const frameStyle = (hex) => `BORDER FRAME: thick solid rectangle border around entire page, color exactly ${hex}. HEADER BAR: filled rectangle at top, background color exactly ${hex}, white bold text only — no colored badges, no colored pills, no highlights on individual header items. Use this exact color ${hex} for border and header bar on this page.`

const TYPE_STYLE = {
  cover: 'COVER PAGE: Large decorative title centered on page. Student name line and date line below title. Decorative thematic border or illustration. NO questions, NO exercises, NO answer spaces. Title page only.',
  worksheet: 'WORKSHEET PAGE: Clear instruction line at top. Numbered exercise items with ample blank writing space for student answers. Ruled lines or answer boxes as needed.',
  activity: 'ACTIVITY PAGE: Engaging activity layout with clear instructions. Interactive elements such as matching, cut-and-paste areas, drawing boxes, or fill-in diagrams. Ample space for student work.',
}

/**
 * Generate every page image for a plan.
 *
 * Cover/worksheet/activity pages go through gpt-image-2 with bounded concurrency
 * (env `PAGE_CONCURRENCY`, default 1 = sequential). Each is vision-validated and
 * (if it has an imageSpec) answer-reconciled, retrying up to MAX_ATTEMPTS on
 * validation failure. Answer keys are pure text, so they are rendered locally from
 * an SVG template — no image/QA cost — and only after every other page is done, so
 * they reflect reconciled answers. Output order matches plan.pages.
 */
/** Chart pages (valid structured chart) are drawn by code, not gpt-image-2. Pure. */
export const isChartPage = (page) =>
  (page.type === 'worksheet' || page.type === 'activity') && !!page.content?.chart && validateChart(page.content.chart).length === 0

/**
 * Which renderer draws a page. Answer keys, chart pages and the cover keep their
 * own renderers; worksheet/activity pages go to the hybrid layout engine only with
 * PAGE_RENDERER=hybrid AND a P1 layout that fits their content — everything else
 * stays on gpt-image-2 ('legacy'). Pure apart from an unknown-flag warning.
 * @returns {{ route: 'answer_key'|'chart'|'cover'|'hybrid'|'legacy', layout?: string, wordBank?: string[], reason?: string }}
 */
export function routePage(page, env = process.env) {
  if (page.type === 'answer_key') return { route: 'answer_key' }
  if (isChartPage(page)) return { route: 'chart' }
  if (page.type === 'cover') return { route: 'cover' }
  if (pageRenderer(env) !== 'hybrid') return { route: 'legacy' }
  const c = classifyHybridLayout(page)
  return c.layout ? { route: 'hybrid', ...c } : { route: 'legacy', reason: c.reason }
}

/**
 * Worksheet/activity page. Hybrid pages skip validate/reconcile (text is exact).
 * A page with no P1 layout, or whose content overflows the hybrid layout, is drawn
 * by gpt-image-2 instead (info log), so a hybrid run still completes end-to-end
 * during the rollout. Deps are injectable for tests.
 */
export async function generateWorksheetPage(plan, page, {
  env = process.env,
  illustrations,
  hybrid = renderHybridPage,
  legacy = generateOnePage,
} = {}) {
  const r = routePage(page, env)
  if (r.route === 'hybrid') {
    try {
      const { buffer, meta } = await hybrid(plan, page, { layout: r.layout, wordBank: r.wordBank, spec: r.spec, illustrations })
      console.log(`Rendered hybrid page ${page.pageNum}/${plan.pageCount}: ${page.filename} (${r.layout}, ${meta?.size ?? '?'}px, art ${meta?.art ?? '?'})`)
      return { ...page, buffer }
    } catch (err) {
      if (!(err instanceof LayoutOverflowError)) {
        console.warn(`p${page.pageNum}: hybrid render failed (${err.message}) — using gpt-image-2`)
        addReviewNote('fallback', `p${page.pageNum} (${page.filename}): hybrid render failed (${err.message}); drawn by gpt-image-2 instead`)
      } else {
        console.log(`p${page.pageNum}: content too long for the ${r.layout} layout — using gpt-image-2`)
      }
    }
  } else if (r.reason) {
    console.log(`p${page.pageNum}: no hybrid layout yet (${r.reason}) — using gpt-image-2`)
  }
  return legacy(plan, page)
}

export async function generatePages(plan, { env = process.env } = {}) {
  const concurrency = parseInt(env.PAGE_CONCURRENCY ?? '1', 10) || 1
  const illustrations = pageRenderer(env) === 'hybrid'
    ? createIllustrationProvider({ concurrency: readConcurrency(env, 'ILLUSTRATION_CONCURRENCY', 2) })
    : null
  const aiPages = plan.pages.filter(p => p.type !== 'answer_key' && !isChartPage(p))
  const generated = await mapWithConcurrency(aiPages, concurrency, page =>
    page.type === 'cover' ? generateCoverPage(plan, page) : generateWorksheetPage(plan, page, { env, illustrations }))

  let next = 0
  return Promise.all(plan.pages.map(async page => {
    if (isChartPage(page)) {
      const buffer = await renderSvg(chartPageSvg(plan, page))
      console.log(`Rendered chart page ${page.pageNum}/${plan.pageCount}: ${page.filename} (${page.content.chart.type})`)
      return { ...page, buffer }
    }
    if (page.type !== 'answer_key') return generated[next++]
    const buffer = await renderSvg(answerKeySvg(plan, page))
    console.log(`Rendered answer key page ${page.pageNum}/${plan.pageCount}: ${page.filename}`)
    return { ...page, buffer }
  }))
}

/**
 * Cover page. With COVER_RENDERER=hybrid and Cloudflare credentials, FLUX draws the
 * illustration and code draws the text (no validate/reconcile: the text is exact and
 * a cover has no questions). Fail-open: any hybrid error falls back to the
 * gpt-image-2 path with a review note. Deps are injectable for tests.
 */
export async function generateCoverPage(plan, page, {
  env = process.env,
  hybrid = renderHybridCover,
  legacy = generateOnePage,
} = {}) {
  if (useHybridCover(env)) {
    try {
      const buffer = await hybrid(plan)
      console.log(`Rendered hybrid cover page ${page.pageNum}/${plan.pageCount}: ${page.filename} (FLUX + template)`)
      return { ...page, buffer }
    } catch (err) {
      console.warn(`Hybrid cover failed (${err.message}) — falling back to gpt-image-2`)
      addReviewNote('fallback', `Hybrid cover failed (${err.message}); cover drawn by gpt-image-2 instead`)
    }
  }
  return legacy(plan, page)
}

async function generateOnePage(plan, page) {
  const prompt = buildPrompt(plan, page)
  const client = openai()
  let buffer

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await withRetry(() => client.images.generate({
      model: MODELS.image,
      prompt,
      size: page.type === 'cover' ? IMAGE_SIZE.cover : IMAGE_SIZE.page,
      // Cover stays medium (first thing buyers see). Worksheet/activity pages use low:
      // ~158 vs ~1,372 output tokens (~$0.006 vs ~$0.042) with equally crisp text and
      // exact chart values in side-by-side tests.
      quality: page.type === 'cover' ? 'medium' : 'low',
    }), { label: `OpenAI image p${page.pageNum}` })
    recordUsage(page.type === 'cover' ? 'cover_image' : 'page_image', MODELS.image, response.usage)

    if (!response.data?.[0]?.b64_json) throw new Error(`OpenAI image API returned no data for page ${page.pageNum}`)
    buffer = Buffer.from(response.data[0].b64_json, 'base64')

    const validation = await validatePage(page, buffer, plan)
    if (validation.pass) {
      if (page.content?.imageSpec) await reconcilePageContent(page, buffer)
      buffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer()
      console.log(`Generated page ${page.pageNum}/${plan.pageCount}: ${page.filename} (attempt ${attempt})`)
      break
    }

    if (attempt === MAX_ATTEMPTS) {
      console.warn(`Page ${page.pageNum} failed validation after ${MAX_ATTEMPTS} attempts: ${validation.issues.join(', ')}`)
      addReviewNote('qa_failed', `p${page.pageNum} (${page.filename}): ${validation.issues.filter(i => i.startsWith('[critical]')).join('; ')}`)
    } else {
      console.log(`Page ${page.pageNum} validation failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${validation.issues.join(', ')} — retrying...`)
    }
  }

  return { ...page, buffer }
}

/**
 * Build the full gpt-image-2 prompt for a cover/worksheet/activity page (answer
 * keys are template-rendered). Pure function (no IO) — exported for unit testing.
 */
export function buildPrompt(plan, page) {
  const typeStyle = TYPE_STYLE[page.type] ?? TYPE_STYLE.worksheet
  const headerInfo = `"${plan.setTitle}" | ${plan.gradeLevel} | Page ${page.pageNum} of ${plan.pageCount}`

  let contentBlock = ''
  if (page.content) {
    const specPart = page.content.imageSpec
      ? ` EXACT VISUAL DATA — draw precisely as specified: ${page.content.imageSpec}`
      : ''
    const qPart = page.content.questions?.length > 0
      ? ` Questions to include:\n${page.content.questions.map(q => `${q.num}. ${q.question}`).join('\n')}`
      : ''
    contentBlock = specPart + qPart
  }

  const baseStyle = BASE_STYLE[page.type] ?? BASE_STYLE.default
  return `${baseStyle} ${frameStyle(plan.themeColor)} ${typeStyle} Header bar: ${headerInfo}. ${page.imagePrompt}${contentBlock}`.trim()
}
