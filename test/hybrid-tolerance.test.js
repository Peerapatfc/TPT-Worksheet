import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  coercePages, inferLayout, titleFromPage, matchRawPages, normalizeHybridPage, validateHybridPage,
  generateHybridPages, generateHybridContent, fetchHybridChunk, pagesFromFailedGeneration,
  buildHybridContentPrompt, hybridContentTool, EXPECTED_SHAPE,
} from '../src/steps/hybrid-content.js'
import { resetReviewNotes } from '../src/lib/review-notes.js'

// Shapes of the malformed generate_layout_content answers seen in the last live eval
// (gpt-oss-120b on Groq): bare array of pages, pages without title/layout, a flat
// single page, and 400 tool_use_failed whose failed_generation holds a bare array.
const plan = { setTitle: 'Test Set', gradeLevel: 'Grade 2', subject: 'Math', packageType: 'small', themeColor: '#2E7D32', pageCount: 12 }
const page = (pageNum, filename, imagePrompt, type = 'worksheet') => ({ pageNum, type, filename, imagePrompt })
const optsFor = (p, title) => ({ packageType: 'small', plan, page: { ...p, title } })

const qs = [
  { num: 1, question: 'What is 2 + 3?', answer: '5' },
  { num: 2, question: 'What is 4 + 4?', answer: '8' },
  { num: 3, question: 'What is 10 - 6?', answer: '4' },
  { num: 4, question: 'What is 7 + 2?', answer: '9' },
]
const shapeItems = [
  { kind: 'fraction', shape: 'circle', parts: 4, shaded: 1, ask: 'name' },
  { kind: 'fraction', shape: 'rectangle', parts: 3, shaded: 2, ask: 'name' },
  { kind: 'fraction', shape: 'bar', parts: 2, shaded: 1, ask: 'shade' },
  { kind: 'fraction', shape: 'circle', parts: 8, shaded: 3, ask: 'name' },
]
const bareArrayString = JSON.stringify([{ pageNum: 2, title: 'Adding', layout: 'questions', questions: qs }])
const untitled = { pages: [{ pageNum: 2, questions: qs }] }
const flatShapes = { layout: 'shapes', shapeItems }
const failedGeneration = (pages) => JSON.stringify({ name: 'generate_layout_content', arguments: pages })

const p2 = page(2, 'addition-practice', 'Word problems about adding apples')
const p3 = page(3, 'fraction-shapes', 'Shade the fraction of each shape')

beforeEach(() => { resetReviewNotes(); vi.stubEnv('MATCHING_SELF_CHECK', 'off'); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('coercePages: every observed answer shape', () => {
  it('reads a bare-array JSON string, {pages:[...]}, {pages:{"1":…}}, a {name, arguments} wrapper and a flat page', () => {
    expect(coercePages(bareArrayString).map(p => p.pageNum)).toEqual([2])
    expect(coercePages(untitled)).toEqual(untitled.pages)
    expect(coercePages({ pages: { 1: { pageNum: 2 }, 2: { pageNum: 3 } } }).map(p => p.pageNum)).toEqual([2, 3])
    expect(coercePages({ pages: { pageNum: 4, layout: 'questions' } })).toEqual([{ pageNum: 4, layout: 'questions' }])
    expect(coercePages(JSON.parse(failedGeneration([{ pageNum: 2 }, { pageNum: 3 }]))).map(p => p.pageNum)).toEqual([2, 3])
    expect(coercePages(flatShapes)).toEqual([flatShapes])
    expect(coercePages([{ pages: [{ pageNum: 2 }] }])).toEqual([{ pageNum: 2 }])
  })

  it('returns [] for anything without pages', () => {
    for (const v of [null, undefined, '', 'not json', '[oops', 42, {}, { foo: 1 }, [1, 'x', null]]) expect(coercePages(v)).toEqual([])
  })

  it('pagesFromFailedGeneration parses the wrapper, or the text after "arguments" when the wrapper is malformed', () => {
    expect(pagesFromFailedGeneration(failedGeneration([{ pageNum: 2, questions: qs }]))).toHaveLength(1)
    const broken = `{"name": generate_layout_content, "arguments": [${JSON.stringify({ pageNum: 5, ...flatShapes })}]}`
    expect(pagesFromFailedGeneration(broken).map(p => p.pageNum)).toEqual([5])
    expect(pagesFromFailedGeneration('{"name": "generate_layout_content", "arguments": [\n  {\n   ')).toEqual([])
    expect(pagesFromFailedGeneration(undefined)).toEqual([])
  })
})

describe('inferLayout + title default', () => {
  it('infers the layout from the fields a page carries', () => {
    expect(inferLayout({ chart: { type: 'bar', categories: [{ label: 'A', value: 2 }] } })).toBe('chart')
    expect(inferLayout({ chart: {}, questions: qs }, p2)).toBe('questions') // gpt-oss writes chart: {} on non-chart pages
    expect(inferLayout({ pairs: [{ term: 'a', match: 'b' }] })).toBe('matching')
    expect(inferLayout({ sortItems: [{ word: 'dog', category: 'Living' }] })).toBe('sorting')
    expect(inferLayout({ categories: ['Living', 'Nonliving'] })).toBe('sorting')
    expect(inferLayout({ labels: [{ word: 'root', clue: 'holds the plant' }] })).toBe('labeling')
    expect(inferLayout({ sentences: [{ sentence: 'A ___', answer: 'b' }] })).toBe('fill_blank')
    expect(inferLayout({ rows: [['a', '[b]']] })).toBe('table_fill')
    expect(inferLayout({ shapeItems })).toBe('shapes')
    expect(inferLayout({ instruction: 'Colour the picture.' })).toBe('activity_art')
    expect(inferLayout({ questions: [{ question: 'Q', options: ['a', 'b'], answer: 'A' }] })).toBe('multiple_choice')
    expect(inferLayout({ questions: qs })).toBe('questions')
    expect(inferLayout({ questions: qs }, page(4, 'fruit-graph', 'A picture graph of fruit'))).toBe('chart')
    expect(inferLayout({ title: 'x' }, p3)).toBe('shapes') // nothing to go on: the plan hint
  })

  it('titleFromPage turns the plan filename into words', () => {
    expect(titleFromPage(p2)).toBe('Addition Practice')
    expect(titleFromPage(page(7, '07_plant-parts.png', ''))).toBe('Plant Parts')
    expect(titleFromPage({ pageNum: 9 })).toBe('Page 9')
  })

  it('the three observed shapes become valid pages through matchRawPages', () => {
    const [a] = matchRawPages([p2], bareArrayString)
    const [b] = matchRawPages([p2], untitled)
    const [c] = matchRawPages([p3], flatShapes)
    expect(b).toMatchObject({ pageNum: 2, title: 'Addition Practice', layout: 'questions', layoutInferred: true })
    expect(c).toMatchObject({ pageNum: 3, title: 'Fraction Shapes', layout: 'shapes' })
    for (const [r, p] of [[a, p2], [b, p2], [c, p3]]) {
      const n = normalizeHybridPage(r)
      expect(validateHybridPage(n, optsFor(p, r.title))).toEqual([])
    }
    expect(normalizeHybridPage(b).repairs.some(x => /inferred questions/.test(x))).toBe(true)
  })
})

describe('prompt + schema', () => {
  it('ends with the expected call shape and requires nothing that Groq would reject the call over', () => {
    expect(buildHybridContentPrompt(plan, [p2]).trim().endsWith(EXPECTED_SHAPE)).toBe(true)
    const params = hybridContentTool.function.parameters
    expect(params.required).toBeUndefined()
    expect(params.properties.pages.items.required).toBeUndefined()
  })
})

describe('generateHybridPages: tolerant matching and capped 400 retries', () => {
  const four = [p2, p3, page(4, 'more-adding', 'Word problems about adding'), page(5, 'even-more', 'Word problems about adding')]
  const good = (g) => (g.pageNum === 3 ? { pageNum: 3, ...flatShapes } : { pageNum: g.pageNum, questions: qs })

  it('untitled, layout-less pages from the fetcher all validate', async () => {
    const fetchChunk = vi.fn(async (_p, group) => ({ pages: group.map(g => { const { layout, ...r } = good(g); return r }) }))
    const { pages, failed } = await generateHybridPages(plan, four, { fetchChunk })
    expect(failed).toEqual([])
    expect(fetchChunk).toHaveBeenCalledTimes(2)
    expect(pages.get(2).content.title).toBe('Addition Practice')
    expect(pages.get(3).content.layout).toBe('shapes')
  })

  const clientThrowing = (errFor) => {
    const create = vi.fn(async (req) => { throw errFor(req) })
    return { create, client: () => ({ chat: { completions: { create } } }) }
  }
  const pagesOf = (req) => [...req.messages[0].content.matchAll(/^- Page (\d+)/gm)].map(m => Number(m[1]))
  const toolUseFailed = (fg) => Object.assign(new Error('400'), { status: 400, error: { message: 'Failed to parse tool call arguments as JSON', type: 'invalid_request_error', code: 'tool_use_failed', failed_generation: fg } })

  it('recovers pages from a 400 tool_use_failed failed_generation: one call per group, full text kept in stats', async () => {
    const { create, client } = clientThrowing(req => toolUseFailed(failedGeneration(pagesOf(req).map(n => good({ pageNum: n })))))
    const stats = { calls: [], pages: [] }
    const fetchChunk = (p, g, f, st) => fetchHybridChunk(p, g, f, st, { client })
    const { pages, failed } = await generateHybridPages(plan, four, { fetchChunk, stats })
    expect(failed).toEqual([])
    expect([...pages.keys()].sort()).toEqual([2, 3, 4, 5])
    expect(create).toHaveBeenCalledTimes(2) // groups [2,3,4] and [5], no retries
    expect(stats.calls[0]).toMatchObject({ error: 400, code: 'tool_use_failed', recovered: 3 })
    expect(stats.calls[0].failedGeneration.length).toBeGreaterThan(200) // not truncated
  })

  it('every first-round call 400 with nothing recoverable → legacy at once, no per-page retries', async () => {
    const { create, client } = clientThrowing(() => toolUseFailed('{"name": "generate_layout_content", "arguments": [\n  {\n   '))
    const fetchChunk = (p, g, f, st) => fetchHybridChunk(p, g, f, st, { client })
    const legacy = vi.fn(async (_p, failedPages) => failedPages.map(p => ({ pageNum: p.pageNum, title: 'Legacy', imageSpec: '', questions: qs })))
    const out = await generateHybridContent(plan, four, { fetchChunk, legacy, check: async () => ({ pass: true, corrections: [] }) })
    expect(create).toHaveBeenCalledTimes(2)
    expect(legacy.mock.calls[0][1].map(p => p.pageNum)).toEqual([2, 3, 4, 5])
    expect(out.get(2).title).toBe('Legacy')
  })

  it('a group that keeps failing with 400 gets one single-page retry, then legacy', async () => {
    const seen = []
    const fetchChunk = async (_p, group) => {
      seen.push(group.map(g => g.pageNum))
      return group.some(g => g.pageNum === 5) ? { chunkError: { status: 400, code: 'tool_use_failed' } } : group.map(good)
    }
    const { pages, failed } = await generateHybridPages(plan, four, { fetchChunk })
    expect(seen).toEqual([[2, 3, 4], [5], [5]])
    expect(failed.map(p => p.pageNum)).toEqual([5])
    expect([...pages.keys()].sort()).toEqual([2, 3, 4])
  })

  it('a 400 group of three retries each page once (not 3 rounds)', async () => {
    const seen = []
    const fetchChunk = async (_p, group) => {
      seen.push(group.map(g => g.pageNum))
      return group.some(g => g.pageNum === 2 || g.pageNum === 3 || g.pageNum === 4) ? { chunkError: { status: 400 } } : group.map(good)
    }
    const { failed } = await generateHybridPages(plan, four, { fetchChunk })
    expect(seen).toEqual([[2, 3, 4], [5], [2], [3], [4]])
    expect(failed.map(p => p.pageNum)).toEqual([2, 3, 4])
  })

  it('retry feedback for an unreadable page is the expected shape, not "missing from your answer"', async () => {
    const fb = []
    const fetchChunk = async (_p, group, feedback) => { fb.push(new Map(feedback)); return fb.length === 1 ? null : group.map(good) }
    const { failed } = await generateHybridPages(plan, [p2], { fetchChunk })
    expect(failed).toEqual([])
    expect(fb[1].get(2)[0]).toContain(EXPECTED_SHAPE)
  })
})
