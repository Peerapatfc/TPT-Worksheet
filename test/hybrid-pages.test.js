import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { classifyHybridLayout, parseWordBank } from '../src/lib/layout/classify.js'
import { pageIllustrationSubject, buildPageIllustrationPrompt, createIllustrationProvider, PAGE_ILLUSTRATION_STYLE, NO_TEXT } from '../src/lib/illustrations.js'
import { pageRenderer, renderHybridPage } from '../src/lib/hybrid-page.js'
import { routePage, generateWorksheetPage } from '../src/steps/generate-pages.js'
import { LayoutOverflowError } from '../src/lib/layout/measure.js'
import { generateIllustration } from '../src/llm/flux.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'
import { costSummary, resetUsage } from '../src/lib/cost-tracker.js'
import { MAX_PROMPT_CHARS } from '../src/lib/hybrid-cover.js'

const plan = { setTitle: 'Autumn Math Adventures', gradeLevel: 'Grade 2', subject: 'Math', themeColor: '#E8731C', pageCount: 10 }
const qPage = (questions, extra = {}) => ({ pageNum: 2, type: 'worksheet', filename: 'p2', imagePrompt: '', content: { title: 'Addition', imageSpec: '', questions }, ...extra })
const plain = qPage([{ num: 1, question: 'What is 7 + 5?', answer: '12' }, { num: 2, question: 'If you have 9 apples and give away 4, how many are left?', answer: '5' }])
const blanks = qPage([{ num: 1, question: 'The ___ sat on the mat.', answer: 'cat' }, { num: 2, question: 'The ___ barked.', answer: 'dog' }])
const picture = qPage([{ num: 1, question: 'Draw a line connecting each picture to its correct CVC word.', answer: '1 cat, 2 dog' }])

describe('classifyHybridLayout', () => {
  it('plain self-contained questions → questions', () => {
    expect(classifyHybridLayout(plain)).toEqual({ layout: 'questions' })
  })

  it('blank sentences → fill_blank with an alphabetical bank of the answers', () => {
    expect(classifyHybridLayout(blanks)).toEqual({ layout: 'fill_blank', wordBank: ['cat', 'dog'] })
  })

  it('uses a word bank from the imageSpec when it covers every answer', () => {
    const page = qPage([{ num: 1, question: 'The edge of a leaf is the _____ (blank 1).', answer: 'margin' }, { num: 2, question: 'The main line is the _____ (blank 2).', answer: 'vein' }])
    page.content.imageSpec = 'Five sentences with numbered blanks (1‑5). Word bank at bottom: lobe, vein, margin, symmetry, petiole.'
    expect(classifyHybridLayout(page)).toEqual({ layout: 'fill_blank', wordBank: ['lobe', 'vein', 'margin', 'symmetry', 'petiole'] })
    expect(parseWordBank('Table with three columns')).toBeNull()
  })

  it('pages that need a drawn picture/activity stay on the legacy renderer', () => {
    expect(classifyHybridLayout(picture).layout).toBeNull()
    expect(classifyHybridLayout(qPage([{ num: 1, question: 'How many pumpkins are shown in the picture?', answer: '9' }])).layout).toBeNull()
    expect(classifyHybridLayout(qPage([{ num: 1, question: 'Cut out the pictures and sort them.', answer: 'x' }])).layout).toBeNull()
    expect(classifyHybridLayout({ ...plain, content: { ...plain.content, imageSpec: 'Table with Leaf, Length' } })).toMatchObject({ layout: null, reason: 'imageSpec present' })
    expect(classifyHybridLayout({ ...plain, type: 'cover' }).layout).toBeNull()
    expect(classifyHybridLayout({ ...plain, content: { ...plain.content, chart: { type: 'bar' } } }).layout).toBeNull()
  })
})

describe('page illustration prompt', () => {
  it('takes the decoration named in the imagePrompt', () => {
    const page = { ...plain, imagePrompt: 'A worksheet with five problems, decorated with a smiling squirrel holding an acorn. Title "Fall Fun" at the top.' }
    expect(pageIllustrationSubject(plan, page)).toBe('a smiling squirrel holding an acorn')
  })

  it('falls back to topic words from the page and set titles, never worksheet/maths words', () => {
    const s = pageIllustrationSubject({ ...plan, setTitle: 'Autumn Leaf Geometry Worksheets' }, { ...plain, content: { ...plain.content, title: 'Leaf Fractions Practice' } })
    expect(s).toBe('leaf autumn geometry themed objects')
    expect(pageIllustrationSubject({ setTitle: 'CVC Word Families', subject: 'ELA' }, { content: { title: 'Fill in the Missing CVC Word' } })).toBe('cheerful ela classroom objects')
  })

  it('wraps the subject in the fixed style + no-text guard, within the FLUX prompt limit', () => {
    const p = buildPageIllustrationPrompt('a red maple leaf')
    expect(p.startsWith(PAGE_ILLUSTRATION_STYLE)).toBe(true)
    expect(p).toContain('a red maple leaf')
    expect(p.endsWith(NO_TEXT)).toBe(true)
    expect(buildPageIllustrationPrompt('word '.repeat(500)).length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
  })
})

describe('illustration provider', () => {
  const prepare = async () => ({ png: Buffer.from('png'), width: 10, height: 8 })

  it('generates identical prompts once per run (even concurrently)', async () => {
    const generate = vi.fn(async () => Buffer.from('raw'))
    const ill = createIllustrationProvider({ generate, prepare })
    const [a, b] = await Promise.all([ill.get('A  cat'), ill.get('a cat')])
    await ill.get('a dog')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(a).toBe(b)
    expect(a).toEqual({ href: `data:image/png;base64,${Buffer.from('png').toString('base64')}`, width: 10, height: 8 })
  })

  it('caps concurrent FLUX calls', async () => {
    let active = 0
    let peak = 0
    const generate = async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return Buffer.from('x') }
    const ill = createIllustrationProvider({ generate, prepare, concurrency: 2 })
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(p => ill.get(p)))
    expect(peak).toBe(2)
    expect(ill.calls()).toBe(5)
  })

  it('records page FLUX calls under the page_illustration bucket', async () => {
    resetUsage()
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: { image: Buffer.from('img').toString('base64') } }) })
    await generateIllustration('p', { env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, fetchImpl, bucket: 'page_illustration' })
    expect(costSummary().byStep.map(e => e.step)).toEqual(['page_illustration'])
  })
})

describe('PAGE_RENDERER routing', () => {
  it('reads the flag: unset/empty/openai → openai, hybrid → hybrid, unknown → openai', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(pageRenderer({})).toBe('openai')
    expect(pageRenderer({ PAGE_RENDERER: '' })).toBe('openai')
    expect(pageRenderer({ PAGE_RENDERER: ' Hybrid ' })).toBe('hybrid')
    expect(pageRenderer({ PAGE_RENDERER: 'flux' })).toBe('openai')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('flag off → legacy; hybrid + covered layout → hybrid; hybrid + uncovered → legacy', () => {
    expect(routePage(plain, {})).toEqual({ route: 'legacy' })
    expect(routePage(plain, { PAGE_RENDERER: 'hybrid' })).toEqual({ route: 'hybrid', layout: 'questions' })
    expect(routePage(blanks, { PAGE_RENDERER: 'hybrid' })).toMatchObject({ route: 'hybrid', layout: 'fill_blank' })
    expect(routePage(picture, { PAGE_RENDERER: 'hybrid' })).toMatchObject({ route: 'legacy' })
  })

  it('cover, chart and answer-key pages keep their own renderers under the flag', () => {
    const env = { PAGE_RENDERER: 'hybrid' }
    expect(routePage({ ...plain, type: 'cover' }, env).route).toBe('cover')
    expect(routePage({ type: 'answer_key' }, env).route).toBe('answer_key')
    const chart = { ...plain, content: { ...plain.content, chart: { type: 'bar', title: 'T', categories: [{ label: 'A', value: 2 }, { label: 'B', value: 3 }] } } }
    expect(routePage(chart, env).route).toBe('chart')
  })

  describe('generateWorksheetPage', () => {
    let log
    beforeEach(() => { log = vi.spyOn(console, 'log').mockImplementation(() => {}); resetReviewNotes() })

    it('flag off → gpt-image-2 path only', async () => {
      const hybrid = vi.fn()
      const legacy = vi.fn(async (p, page) => ({ ...page, buffer: Buffer.from('legacy') }))
      const out = await generateWorksheetPage(plan, plain, { env: {}, hybrid, legacy })
      expect(out.buffer.toString()).toBe('legacy')
      expect(hybrid).not.toHaveBeenCalled()
    })

    it('hybrid + covered layout → hybrid renderer, no legacy (so no validate/reconcile)', async () => {
      const hybrid = vi.fn(async () => ({ buffer: Buffer.from('hybrid'), meta: { size: 30, art: 'band' } }))
      const legacy = vi.fn()
      const out = await generateWorksheetPage(plan, plain, { env: { PAGE_RENDERER: 'hybrid' }, hybrid, legacy, illustrations: {} })
      expect(out.buffer.toString()).toBe('hybrid')
      expect(hybrid).toHaveBeenCalledWith(plan, plain, expect.objectContaining({ layout: 'questions' }))
      expect(legacy).not.toHaveBeenCalled()
    })

    it('hybrid + uncovered layout → legacy with an info log', async () => {
      const hybrid = vi.fn()
      const legacy = vi.fn(async (p, page) => ({ ...page, buffer: Buffer.from('legacy') }))
      await generateWorksheetPage(plan, picture, { env: { PAGE_RENDERER: 'hybrid' }, hybrid, legacy })
      expect(hybrid).not.toHaveBeenCalled()
      expect(legacy).toHaveBeenCalledOnce()
      expect(log.mock.calls.flat().join(' ')).toMatch(/no hybrid layout yet/)
    })

    it('layout overflow → legacy; other hybrid errors → legacy + review note', async () => {
      const legacy = vi.fn(async (p, page) => ({ ...page, buffer: Buffer.from('legacy') }))
      await generateWorksheetPage(plan, plain, { env: { PAGE_RENDERER: 'hybrid' }, hybrid: async () => { throw new LayoutOverflowError('too long') }, legacy })
      expect(reviewNotes()).toHaveLength(0)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await generateWorksheetPage(plan, plain, { env: { PAGE_RENDERER: 'hybrid' }, hybrid: async () => { throw new Error('boom') }, legacy })
      warn.mockRestore()
      expect(legacy).toHaveBeenCalledTimes(2)
      expect(reviewNotes()[0]).toMatchObject({ kind: 'fallback' })
    })
  })
})

describe('renderHybridPage', () => {
  beforeEach(() => resetReviewNotes())

  it('FLUX failure → page still renders (decorative motifs) with a fallback review note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const illustrations = { get: vi.fn(async () => { throw new Error('FLUX HTTP 429') }) }
    const { buffer, meta } = await renderHybridPage(plan, plain, { layout: 'questions', illustrations })
    warn.mockRestore()
    const m = await sharp(buffer).metadata()
    expect([m.width, m.height]).toEqual([1024, 1536])
    expect(meta.art).toBe('band')
    expect(reviewNotes()).toEqual([expect.objectContaining({ kind: 'fallback', message: expect.stringContaining('FLUX HTTP 429') })])
  })

  it('embeds the prepared illustration and asks for it with the page prompt', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer()
    const illustrations = { get: vi.fn(async () => ({ href: `data:image/png;base64,${png.toString('base64')}`, width: 40, height: 30 })) }
    const page = { ...plain, imagePrompt: 'A page decorated with a red maple leaf.' }
    const { meta } = await renderHybridPage(plan, page, { layout: 'questions', illustrations })
    expect(illustrations.get).toHaveBeenCalledWith(buildPageIllustrationPrompt('a red maple leaf'))
    expect(meta).toMatchObject({ layout: 'questions', subject: 'a red maple leaf', art: 'band' })
    expect(reviewNotes()).toHaveLength(0)
  })

  it('skips the FLUX call when the page has no room for art', async () => {
    const illustrations = { get: vi.fn() }
    const page = qPage(Array.from({ length: 12 }, (_, k) => ({ num: k + 1, question: 'Sam has some apples in a basket and gives a few away to his friends at school after lunch. How many are left?', answer: 'Some apples are left over for later' })))
    const { meta } = await renderHybridPage(plan, page, { layout: 'questions', illustrations })
    expect(meta.art).toBe('dropped')
    expect(illustrations.get).not.toHaveBeenCalled()
  })
})
