// PAGE_RENDERER=hybrid-only (zero-OpenAI mode): every page, the cover and the
// marketing cover are drawn by code + FLUX, and nothing constructs an OpenAI client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

// Count every OpenAI SDK construction (the openai() and groq() singletons both use it).
const constructed = vi.hoisted(() => ({ count: 0 }))
vi.mock('openai', () => ({
  default: vi.fn(function OpenAI() {
    constructed.count++
    this.images = { generate: vi.fn(async () => { throw new Error('OpenAI images must not be called') }) }
    this.chat = { completions: { create: vi.fn(async () => { throw new Error('OpenAI chat must not be called') }) } }
  }),
}))

// FLUX: a real PNG, or a failure for prompts containing "FAILME".
const flux = vi.hoisted(() => ({ calls: [] }))
vi.mock('../src/llm/flux.js', async () => {
  const sharpMod = (await import('sharp')).default
  return {
    hasCloudflareCreds: (env = process.env) => !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    generateIllustration: vi.fn(async (prompt) => {
      flux.calls.push(prompt)
      if (/FAILME/.test(prompt)) throw new Error('FLUX HTTP 500: mocked failure')
      return sharpMod({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } })
        .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><circle cx="128" cy="128" r="80" fill="#e8731c"/></svg>') }])
        .png().toBuffer()
    }),
  }
})

const { generatePages, generateWorksheetPage, generateCoverPage, routePage } = await import('../src/steps/generate-pages.js')
const { generateMarketingSlides } = await import('../src/steps/generate-marketing-slides.js')
const { openai, openaiConstructed } = await import('../src/llm/clients.js')
const { pageRenderer, isHybridOnly, isHybridRenderer } = await import('../src/config/renderer.js')
const { resolveBrainstormProvider } = await import('../src/lib/brainstorm-provider.js')
const { splitDependentQuestions, plainFormOf, hybridOnlyAttempts, renderHybridOnlyPage, compactPage } = await import('../src/lib/hybrid-only.js')
const { renderTextCover, renderMarketingCover } = await import('../src/lib/hybrid-cover.js')
const { reviewNotes, resetReviewNotes, buildReviewMessage } = await import('../src/lib/review-notes.js')
const { costSummary, resetUsage, recordUsage } = await import('../src/lib/cost-tracker.js')
const { LayoutOverflowError } = await import('../src/lib/layout/measure.js')

const HYBRID_ONLY = { PAGE_RENDERER: 'hybrid-only', CLOUDFLARE_ACCOUNT_ID: 'x', CLOUDFLARE_API_TOKEN: 'y' }

const long = (n) => `Explain in your own words, using at least two complete sentences, why ${'the seasons change and the leaves turn bright colours '.repeat(n)}every year?`
const longAnswer = 'Because the Earth is tilted on its axis, so different parts of the planet get more or less direct sunlight through the year and plants respond to the light.'

function makePlan() {
  const qs = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))
  return {
    setTitle: 'Autumn Leaves Science', gradeLevel: 'Grade 2', subject: 'Science', themeColor: '#E8731C', pageCount: 10,
    tptListing: { title: 'Autumn Leaves Science | Grade 2', subjectAreas: ['Science'] },
    pages: [
      { pageNum: 1, type: 'cover', filename: 'cover', imagePrompt: 'Cover with the title "Autumn Leaves Science", a squirrel holding an acorn under a maple tree.' },
      // Structured questions (P3 hybrid content).
      { pageNum: 2, type: 'worksheet', filename: 'leaf-facts', imagePrompt: '', content: { layout: 'questions', spec: {}, title: 'Leaf Facts', illustrationSubject: 'maple leaf', questions: qs(5, n => ({ num: n, question: `Which tree drops leaf number ${n} in autumn?`, answer: 'red' })) } },
      // Structured matching (P3).
      { pageNum: 3, type: 'activity', filename: 'tree-match', imagePrompt: '', content: { layout: 'matching', title: 'Match the Tree', spec: { pairs: [{ term: 'Oak', match: 'acorn' }, { term: 'Maple', match: 'helicopter seed' }, { term: 'Pine', match: 'cone' }, { term: 'Apple tree', match: 'apple' }] }, questions: [] } },
      // Legacy content (hybrid content step fell back) with picture-dependent questions.
      { pageNum: 4, type: 'worksheet', filename: 'leaf-count', imagePrompt: 'A worksheet decorated with acorns.', content: { title: 'Leaf Count', imageSpec: 'Picture of 7 red leaves and 3 yellow leaves.', questions: [
        { num: 1, question: 'How many red leaves are shown in the picture?', answer: '7' },
        { num: 2, question: 'Which season comes after summer?', answer: 'autumn' },
        { num: 3, question: 'What do trees lose in autumn?', answer: 'leaves' },
        { num: 4, question: 'Circle the yellow leaves.', answer: '3 leaves' },
        { num: 5, question: 'What gas do leaves take in?', answer: 'carbon dioxide' },
        { num: 6, question: 'What makes leaves green?', answer: 'chlorophyll' },
      ] } },
      // Legacy content with no questions at all (uncovered).
      { pageNum: 5, type: 'activity', filename: 'leaf-art', imagePrompt: 'A big maple leaf to decorate.', content: { title: 'Leaf Art', imageSpec: 'A big leaf outline', questions: [] } },
      // Overflow: far too much text for any regular layout.
      { pageNum: 6, type: 'worksheet', filename: 'why-seasons', imagePrompt: '', content: { layout: 'questions', spec: {}, title: 'Why Seasons?', questions: qs(14, n => ({ num: n, question: long(3), answer: longAnswer })) } },
      // FLUX fails for this page's illustration.
      { pageNum: 7, type: 'worksheet', filename: 'acorns', imagePrompt: '', content: { layout: 'questions', spec: {}, title: 'Acorns', illustrationSubject: 'FAILME acorn', questions: qs(4, n => ({ num: n, question: `Sam has ${n} acorns and finds 2 more. How many now?`, answer: String(n + 2) })) } },
      { pageNum: 8, type: 'answer_key', filename: 'key-1', sourcePageNums: [2, 3] },
      { pageNum: 9, type: 'answer_key', filename: 'key-2', sourcePageNums: [4, 5] },
      { pageNum: 10, type: 'answer_key', filename: 'key-3', sourcePageNums: [6, 7] },
    ],
  }
}

let saved
beforeEach(() => {
  saved = { PAGE_RENDERER: process.env.PAGE_RENDERER, OPENAI_API_KEY: process.env.OPENAI_API_KEY }
  delete process.env.OPENAI_API_KEY
  process.env.PAGE_RENDERER = 'hybrid-only'
  constructed.count = 0
  flux.calls.length = 0
  resetReviewNotes()
  resetUsage()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v))
  vi.restoreAllMocks()
})

describe('hybrid-only end to end (pages + cover + marketing, OPENAI_API_KEY unset)', () => {
  it('every page type yields a page and OpenAI is never constructed', async () => {
    const plan = makePlan()
    const [pages, slides] = await Promise.all([generatePages(plan, { env: HYBRID_ONLY }), generateMarketingSlides(plan, { env: HYBRID_ONLY })])

    expect(constructed.count).toBe(0)
    expect(openaiConstructed()).toBe(false)
    expect(pages).toHaveLength(plan.pages.length)
    for (const p of pages) {
      const m = await sharp(p.buffer).metadata()
      expect([m.width, m.height], `p${p.pageNum}`).toEqual([1024, 1536])
    }
    expect(slides.map(s => s.filename)).toEqual(['marketing-cover', 'marketing-whats-included', 'marketing-benefits'])
    expect((await sharp(slides[0].buffer).metadata()).width).toBe(1024)
    // Cover + marketing cover share one FLUX call.
    expect(flux.calls.filter(p => /squirrel/.test(p))).toHaveLength(1)

    const byNum = new Map(pages.map(p => [p.pageNum, p]))
    // Picture-dependent legacy questions (#1, #4) dropped, the rest renumbered.
    expect(byNum.get(4).content.questions.map(q => q.question)).toEqual(['Which season comes after summer?', 'What do trees lose in autumn?', 'What gas do leaves take in?', 'What makes leaves green?'])
    expect(byNum.get(4).content.questions.map(q => q.num)).toEqual([1, 2, 3, 4])
    // No questions → colouring page with no answer-key rows.
    expect(byNum.get(5).content.layout).toBe('activity_art')
    expect(byNum.get(5).content.questions).toEqual([])
    // Overflow → compact, possibly trimmed — still a page with ≥ 1 question.
    expect(byNum.get(6).content.questions.length).toBeGreaterThan(0)

    const notes = reviewNotes()
    expect(notes.some(n => n.kind === 'degraded' && /p4 .*dropped 2/.test(n.message))).toBe(true)
    expect(notes.some(n => n.kind === 'degraded' && /p5 .*colouring/.test(n.message))).toBe(true)
    expect(notes.some(n => n.kind === 'overflow' && /p6 /.test(n.message))).toBe(true)
    expect(notes.some(n => n.kind === 'fallback' && /p7 .*illustration failed/.test(n.message))).toBe(true)
    expect(notes.every(n => !/gpt-image-2 instead|drawn by gpt-image-2/.test(n.message))).toBe(true)

    const cost = costSummary()
    expect(cost.openaiCalls).toBe(0)
    expect(cost.openaiUsd).toBe(0)
    expect(cost.totalUsd).toBe(0)
  })

  it('never reaches the legacy (gpt-image-2 + validate + reconcile) renderer, even when every layout throws', async () => {
    const plan = makePlan()
    const legacy = vi.fn()
    const hybrid = vi.fn(async () => { throw new Error('renderer exploded') })
    for (const page of plan.pages.filter(p => p.type === 'worksheet' || p.type === 'activity')) {
      const out = await generateWorksheetPage(plan, page, { env: HYBRID_ONLY, hybrid, legacy, illustrations: null })
      expect(Buffer.isBuffer(out.buffer)).toBe(true)
    }
    expect(legacy).not.toHaveBeenCalled()
    expect(constructed.count).toBe(0)
  })
})

describe('hybrid-only page fallbacks', () => {
  const plan = makePlan()

  it('routes uncovered pages to hybrid (layout null), never legacy', () => {
    const p4 = plan.pages[3]
    expect(routePage(p4, { PAGE_RENDERER: 'hybrid' }).route).toBe('legacy')
    expect(routePage(p4, { PAGE_RENDERER: 'hybrid-only' })).toMatchObject({ route: 'hybrid', layout: null })
  })

  it('splits picture-dependent and imageSpec-quoting questions', () => {
    const { keep, dropped } = splitDependentQuestions({ imageSpec: 'The sign says "Leaf Market".', questions: [
      { num: 1, question: 'What does the sign "Leaf Market" say?', answer: 'x' },
      { num: 2, question: 'Look at the picture. What is it?', answer: 'x' },
      { num: 3, question: 'Which fruit is long and yellow?', answer: 'banana' },
    ] })
    expect(keep.map(q => q.num)).toEqual([3])
    expect(dropped.map(q => q.num)).toEqual([1, 2])
  })

  it('keeps all questions (with a degraded note) when fewer than 4 would remain', async () => {
    const page = { pageNum: 9, type: 'worksheet', filename: 'x', content: { imageSpec: 'Picture of 5 apples', questions: [
      { num: 1, question: 'How many apples are shown in the picture?', answer: '5' },
      { num: 2, question: 'Which fruit grows on an apple tree?', answer: 'apple' },
    ] } }
    const out = await renderHybridOnlyPage(plan, page, { route: 'hybrid', layout: null }, { illustrations: null })
    expect(out.page.content.questions).toHaveLength(2)
    expect(reviewNotes().some(n => n.kind === 'degraded' && /printed anyway/.test(n.message))).toBe(true)
  })

  it('structured specs convert to self-contained text forms', () => {
    expect(plainFormOf('matching', { pairs: [{ term: 'Oak', match: 'acorn' }, { term: 'Pine', match: 'cone' }, { term: 'Maple', match: 'samara' }] }))
      .toEqual({ layout: 'fill_blank', wordBank: ['acorn', 'cone', 'samara'], questions: [{ num: 1, question: 'Oak: ___', answer: 'acorn' }, { num: 2, question: 'Pine: ___', answer: 'cone' }, { num: 3, question: 'Maple: ___', answer: 'samara' }] })
    expect(plainFormOf('multiple_choice', { questions: [{ num: 1, question: 'Largest planet?', options: ['Mars', 'Jupiter'], answer: 'B' }] }).questions[0])
      .toEqual({ num: 1, question: 'Largest planet? A) Mars  B) Jupiter', answer: 'B. Jupiter' })
    expect(plainFormOf('table_fill', {})).toBeNull()
    expect(plainFormOf('shapes', {})).toBeNull()
  })

  it('overflowing matching page → fill-in conversion with a degraded note; answer key follows', async () => {
    const page = plan.pages[2]
    let n = 0
    const hybrid = vi.fn(async (_p, pg, { layout }) => {
      if (n++ === 0) throw new LayoutOverflowError('too long')
      return { buffer: Buffer.from(layout), meta: { size: 24 } }
    })
    const out = await renderHybridOnlyPage(plan, page, routePage(page, HYBRID_ONLY), { hybrid })
    expect(out.buffer.toString()).toBe('fill_blank')
    expect(out.page.content.questions[0]).toEqual({ num: 1, question: 'Oak: ___', answer: 'acorn' })
    expect(reviewNotes().some(n => n.kind === 'degraded' && /matching layout did not fit/.test(n.message))).toBe(true)
  })

  it('compact layout trims trailing questions only when even 14px two-column overflows', () => {
    const qs = Array.from({ length: 40 }, (_, i) => ({ num: i + 1, question: long(4), answer: longAnswer }))
    const c = compactPage(plan, { pageNum: 6, type: 'worksheet', filename: 'x', content: { questions: qs } }, qs)
    expect(c.dropped).toBeGreaterThan(0)
    expect(c.page.content.questions.length).toBe(qs.length - c.dropped)
    expect(c.out.meta.size).toBeGreaterThanOrEqual(14)
  })

  it('a page with no questions becomes a colouring page', () => {
    const a = hybridOnlyAttempts(plan, plan.pages[4], { route: 'hybrid', layout: null })
    expect(a).toHaveLength(1)
    expect(a[0].layout).toBe('activity_art')
  })
})

describe('hybrid-only cover', () => {
  it('FLUX failure → text-only code cover, never gpt-image-2', async () => {
    const plan = makePlan()
    const legacy = vi.fn()
    const out = await generateCoverPage(plan, plan.pages[0], { env: HYBRID_ONLY, hybrid: async () => { throw new Error('FLUX down') }, legacy })
    expect((await sharp(out.buffer).metadata()).height).toBe(1536)
    expect(legacy).not.toHaveBeenCalled()
    expect(reviewNotes()[0].message).toMatch(/text-only cover/)
  })

  it('no Cloudflare credentials → text-only cover', async () => {
    const plan = makePlan()
    const legacy = vi.fn()
    const textOnly = vi.fn(renderTextCover)
    await generateCoverPage(plan, plan.pages[0], { env: { PAGE_RENDERER: 'hybrid-only' }, textOnly, legacy })
    expect(textOnly).toHaveBeenCalledOnce()
    expect(legacy).not.toHaveBeenCalled()
  })
})

describe('hybrid-only marketing cover', () => {
  it('code + FLUX, no OpenAI image call', async () => {
    const plan = makePlan()
    const image = vi.fn()
    const slides = await generateMarketingSlides(plan, { env: HYBRID_ONLY, image })
    expect(image).not.toHaveBeenCalled()
    expect(slides).toHaveLength(3)
    expect(flux.calls).toHaveLength(1)
  })

  it('FLUX failure → motif marketing cover with a fallback note', async () => {
    const plan = makePlan()
    const out = await renderMarketingCover(plan, { env: HYBRID_ONLY, generate: async () => { throw new Error('nope') } })
    expect(out.illustrated).toBe(false)
    expect((await sharp(out.buffer).metadata()).width).toBe(1024)
    expect(reviewNotes()[0]).toMatchObject({ kind: 'fallback' })
  })
})

describe('hybrid and legacy behaviour unchanged', () => {
  beforeEach(() => { delete process.env.PAGE_RENDERER })

  it('hybrid: uncovered page and overflow still fall back to gpt-image-2', async () => {
    const plan = makePlan()
    const legacy = vi.fn(async (_p, page) => ({ ...page, buffer: Buffer.from('legacy') }))
    expect((await generateWorksheetPage(plan, plan.pages[3], { env: { PAGE_RENDERER: 'hybrid' }, legacy })).buffer.toString()).toBe('legacy')
    await generateWorksheetPage(plan, plan.pages[1], { env: { PAGE_RENDERER: 'hybrid' }, hybrid: async () => { throw new LayoutOverflowError('x') }, legacy })
    expect(legacy).toHaveBeenCalledTimes(2)
  })

  it('COVER_RENDERER=hybrid: a FLUX failure still falls back to gpt-image-2', async () => {
    const plan = makePlan()
    const legacy = vi.fn(async (_p, page) => ({ ...page, buffer: Buffer.from('legacy') }))
    const out = await generateCoverPage(plan, plan.pages[0], { env: { COVER_RENDERER: 'hybrid', CLOUDFLARE_ACCOUNT_ID: 'x', CLOUDFLARE_API_TOKEN: 'y' }, hybrid: async () => { throw new Error('x') }, legacy })
    expect(out.buffer.toString()).toBe('legacy')
  })

  it('default / hybrid: marketing cover is still gpt-image-2', async () => {
    const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#fff' } }).png().toBuffer()
    for (const env of [{}, { PAGE_RENDERER: 'hybrid' }]) {
      const image = vi.fn(async () => png)
      await generateMarketingSlides(makePlan(), { env, image })
      expect(image).toHaveBeenCalledOnce()
    }
  })

  it('openai() constructs a client outside hybrid-only', () => {
    openai({})
    expect(constructed.count).toBe(1)
  })
})

describe('flag resolution', () => {
  it('PAGE_RENDERER: unset/empty/openai → openai, hybrid, hybrid-only (any case / underscore), unknown → openai + warning', () => {
    const warn = vi.fn()
    expect(pageRenderer({}, { warn })).toBe('openai')
    expect(pageRenderer({ PAGE_RENDERER: '' }, { warn })).toBe('openai')
    expect(pageRenderer({ PAGE_RENDERER: 'OpenAI' }, { warn })).toBe('openai')
    expect(pageRenderer({ PAGE_RENDERER: 'hybrid' }, { warn })).toBe('hybrid')
    expect(pageRenderer({ PAGE_RENDERER: ' Hybrid-Only ' }, { warn })).toBe('hybrid-only')
    expect(pageRenderer({ PAGE_RENDERER: 'hybrid_only' }, { warn })).toBe('hybrid-only')
    expect(warn).not.toHaveBeenCalled()
    expect(pageRenderer({ PAGE_RENDERER: 'flux' }, { warn })).toBe('openai')
    expect(warn).toHaveBeenCalledOnce()
    expect([isHybridOnly({ PAGE_RENDERER: 'hybrid' }), isHybridOnly({ PAGE_RENDERER: 'hybrid-only' })]).toEqual([false, true])
    expect([isHybridRenderer({}), isHybridRenderer({ PAGE_RENDERER: 'hybrid' }), isHybridRenderer({ PAGE_RENDERER: 'hybrid-only' })]).toEqual([false, true, true])
  })

  it('openai() throws in hybrid-only mode without constructing a client', () => {
    expect(() => openai({ PAGE_RENDERER: 'hybrid-only' })).toThrow(/hybrid-only/)
    expect(() => openai()).toThrow(/hybrid-only/) // process.env is hybrid-only in this suite
    expect(constructed.count).toBe(0)
  })

  it('hybrid-only forces the Groq brainstorm', () => {
    const warn = vi.fn()
    expect(resolveBrainstormProvider({ PAGE_RENDERER: 'hybrid-only' }, { warn }).provider).toBe('groq')
    expect(resolveBrainstormProvider({ PAGE_RENDERER: 'hybrid-only', BRAINSTORM_PROVIDER: 'openai' }, { warn }).provider).toBe('groq')
    expect(warn).toHaveBeenCalledOnce()
    expect(resolveBrainstormProvider({ PAGE_RENDERER: 'hybrid' }, { warn }).provider).toBe('openai')
  })

  it('review message states the zero-OpenAI run; cost summary splits OpenAI spend', () => {
    recordUsage('content', 'openai/gpt-oss-120b', { prompt_tokens: 1000, completion_tokens: 1000 })
    const cost = costSummary()
    expect(cost.openaiCalls).toBe(0)
    expect(cost.totalUsd).toBeGreaterThan(0)
    const msg = buildReviewMessage('Set', [], cost.totalUsd, undefined, { hybridOnly: { openaiCalls: 0, openaiUsd: 0 } })
    expect(msg).toMatch(/Hybrid-only run .*0 OpenAI calls, OpenAI cost \$0\.00/)
    expect(msg).toMatch(/\$0\.00 on free tiers/)
    recordUsage('page_image', 'gpt-image-2', { input_tokens: 100, output_tokens: 100 })
    expect(costSummary().openaiCalls).toBe(1)
  })
})
