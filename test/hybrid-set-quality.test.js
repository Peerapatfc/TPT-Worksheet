// Set-level quality fixes from the first all-free production run (2026-11-27,
// PAGE_RENDERER=hybrid-only, Grade 4 "Fraction Equivalence Worksheets", run
// 45976219873). Fixtures are that run's real content (Groq/Gemini output) and page
// titles; the plan's imagePrompts were not in the logs, so plan pages carry the
// titles as filenames (the field suggestLayout / polygonsFitTopic read first).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeHybridPage, validateHybridPage, generateHybridPages, suggestLayout, assignLayouts, layoutCap,
  polygonsFitTopic, fitPageTitle, itemSignatures, duplicateOf, hybridPageContent, buildHybridContentPrompt,
  SHAPES_MIN_ITEMS,
} from '../src/steps/hybrid-content.js'
import { textFreeSubject, topicObjects, NO_TEXT } from '../src/lib/flux-subject.js'
import { pageIllustrationSubject, buildPageIllustrationPrompt, buildColoringPrompt } from '../src/lib/illustrations.js'
import { coverSubjects, buildIllustrationPrompt } from '../src/lib/hybrid-cover.js'
import { brainstorm } from '../src/steps/brainstorm.js'
import { resetReviewNotes } from '../src/lib/review-notes.js'

const plan = { setTitle: 'Fraction Equivalence Worksheets', gradeLevel: 'Grade 4', subject: 'Math', packageType: 'large', themeColor: '#1B4F8A', pageCount: 25 }
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const planPage = (pageNum, title) => ({ pageNum, type: 'worksheet', filename: slug(title), imagePrompt: `${title} worksheet for Grade 4.` })

// The 16 content pages of the run, in page order (title as planned).
const RUN_TITLES = [
  [2, 'Fraction Number Line Equivalence'], [3, 'Equivalent Fraction Matching'], [4, 'Number Line Fraction Labeling'],
  [5, 'Comparing Fractions Sorting'], [6, 'Fraction Equivalence Multiple Choice'], [7, 'Fraction Strips Equivalent Fractions'],
  [8, 'Fraction Number Line Fill-In'], [9, 'Shade and Simplify Fractions'], [10, 'Identify Equivalent Fractions'],
  [11, 'Fraction Equivalence Word Problems'], [12, 'Number Line Fraction Equivalence'], [13, 'Match Fractions to Visual Models'],
  [14, 'Comparing Fractions to One-Half'], [15, 'Identifying Equivalent Fractions Multiple Choice'], [16, 'Fraction Equivalence Picture Graph'],
  [17, 'Fraction Equivalence Challenge'],
]
const runPages = RUN_TITLES.map(([n, t]) => planPage(n, t))
const byNum = (n) => runPages.find(p => p.pageNum === n)

// Raw content as the run returned it (pages 2, 9 and 12).
const p2Raw = { pageNum: 2, title: 'Fraction Number Line Equivalence', layout: 'shapes', shapeItems: [
  { kind: 'polygon', shape: 'circle', ask: 'name' }, { kind: 'polygon', shape: 'triangle', ask: 'name' },
] }
const shadeHalves = [4, 6, 8, 10, 12].map(parts => ({ kind: 'fraction', shape: 'bar', parts, shaded: parts / 2, ask: 'shade' }))
const p9Raw = { pageNum: 9, title: 'Shade and Simplify Fractions', layout: 'shapes', shapeItems: shadeHalves }
const p12Raw = { pageNum: 12, title: 'Number Line Fraction Equivalence', layout: 'shapes', shapeItems: shadeHalves }
const opts = (n, title) => ({ packageType: 'large', plan, page: { ...byNum(n), title } })

describe('group 1 — off-topic shapes pages', () => {
  it('rejects the run\'s page 2: polygon naming on a fractions page, and only 2 items', () => {
    const issues = validateHybridPage(normalizeHybridPage(p2Raw), opts(2, p2Raw.title))
    expect(issues[0]).toMatch(/polygon items .* off-topic/)
    expect(issues.some(i => i.includes(`only 2 shapes items (min ${SHAPES_MIN_ITEMS})`))).toBe(true)
  })

  it('still allows polygon items on a shapes/geometry page or set', () => {
    const items = ['triangle', 'pentagon', 'hexagon', 'octagon'].map(shape => ({ kind: 'polygon', shape, ask: 'name' }))
    const n = normalizeHybridPage({ pageNum: 2, title: 'Name the Shapes', layout: 'shapes', shapeItems: items })
    const geo = { ...plan, setTitle: '2D Shapes Worksheets' }
    expect(validateHybridPage(n, { packageType: 'large', plan: geo, page: planPage(2, 'Name the 2D Shapes') })).toEqual([])
    expect(polygonsFitTopic(geo, planPage(3, 'Shape Review'))).toBe(true)
    expect(polygonsFitTopic(plan, byNum(2))).toBe(false)
    expect(polygonsFitTopic(plan, byNum(7))).toBe(false)
    // A fractions page in a geometry set is still a fractions page.
    expect(polygonsFitTopic(geo, planPage(4, 'Fractions of Shapes'))).toBe(false)
    expect(polygonsFitTopic({ ...plan, setTitle: 'Fractions and Polygons' }, planPage(4, 'Polygon Sides and Corners'))).toBe(true)
  })

  it('fraction shapes pages of the run still validate (4+ items, on topic)', () => {
    expect(validateHybridPage(normalizeHybridPage(p9Raw), opts(9, p9Raw.title))).toEqual([])
  })

  it('routes number-line and word-problem pages to questions, not shapes', () => {
    expect(suggestLayout(byNum(2))).toBe('questions')
    expect(suggestLayout(byNum(4))).toBe('questions')
    expect(suggestLayout(byNum(11))).toBe('questions')
    expect(suggestLayout(byNum(12))).toBe('questions')
    expect(suggestLayout(byNum(9))).toBe('shapes')
    // "fraction" is the weakest hint: explicit formats win (these all went to shapes).
    expect(suggestLayout(byNum(3))).toBe('matching')
    expect(suggestLayout(byNum(5))).toBe('sorting')
    expect(suggestLayout(byNum(6))).toBe('multiple_choice')
    expect(suggestLayout(byNum(7))).toBe('shapes')
  })

  it('the content prompt no longer nudges polygon naming and says what cannot be drawn', () => {
    const p = buildHybridContentPrompt(plan, [byNum(2)])
    expect(p).toMatch(/polygon items only on a page about 2D shapes\/geometry/)
    expect(p).toMatch(/No layout draws a number line/)
    expect(p).toMatch(/never promise a number line, word problems/)
    expect(p).toContain('Page 2 (worksheet, suggested layout: questions)')
  })

  it('fitPageTitle removes claims the layout does not print', () => {
    expect(fitPageTitle('Fraction Number Line Equivalence', 'questions')).toBe('Fraction Equivalence Practice')
    expect(fitPageTitle('Fraction Equivalence Word Problems', 'shapes', { items: shadeHalves })).toBe('Fraction Equivalence Models')
    expect(fitPageTitle('Number Line Fraction Labeling', 'fill_blank')).toBe('Fraction Fill-In')
    expect(fitPageTitle('Match Fractions to Visual Models', 'matching')).toBe('Match Fractions')
    expect(fitPageTitle('Fraction Equivalence Multiple Choice', 'questions')).toBe('Fraction Equivalence Practice')
    // Titles that fit are untouched.
    for (const [t, l] of [['Fraction Equivalence Picture Graph', 'chart'], ['Identifying Equivalent Fractions Multiple Choice', 'multiple_choice'], ['Shade and Simplify Fractions', 'shapes'], ['Fraction Equivalence Word Problems', 'questions'], ['Equivalent Fraction Matching', 'matching']]) {
      expect(fitPageTitle(t, l)).toBe(t)
    }
  })

  it('the printed title (content.title) is the fitted one', () => {
    const n = normalizeHybridPage({ ...p2Raw, layout: 'questions', shapeItems: null, questions: [{ num: 1, question: 'q', answer: 'a' }] })
    expect(hybridPageContent({ ...p2Raw, layout: 'questions' }, n).title).toBe('Fraction Equivalence Practice')
  })
})

describe('group 2 — duplicates and layout variety', () => {
  beforeEach(() => { resetReviewNotes(); vi.stubEnv('MATCHING_SELF_CHECK', 'off'); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}) })

  it('page 12 repeats page 9 item for item', () => {
    const s9 = itemSignatures(normalizeHybridPage(p9Raw))
    const s12 = itemSignatures(normalizeHybridPage(p12Raw))
    expect(s9.size).toBe(5)
    expect(duplicateOf(s12, [{ pageNum: 9, sigs: s9 }])).toMatchObject({ pageNum: 9, total: 5 })
    // Same fractions drawn as circles / named instead of shaded is the same drill.
    const circles = normalizeHybridPage({ ...p12Raw, shapeItems: shadeHalves.map(i => ({ ...i, shape: 'circle', ask: 'name' })) })
    expect(duplicateOf(itemSignatures(circles), [{ pageNum: 9, sigs: s9 }])?.pageNum).toBe(9)
    // Page 10 shares only 2/4 and 4/8 of its 6 items with page 9: not a duplicate.
    const p10 = normalizeHybridPage({ pageNum: 10, layout: 'shapes', shapeItems: [[4, 2], [8, 4], [3, 1], [6, 2], [5, 2], [10, 4]].map(([parts, shaded]) => ({ kind: 'fraction', shape: 'bar', parts, shaded, ask: 'name' })) })
    expect(duplicateOf(itemSignatures(p10), [{ pageNum: 9, sigs: s9 }])).toBeNull()
  })

  it('a duplicate page is re-asked with what is already used, and the new page ships', async () => {
    const thirds = [3, 6, 9, 12].map(parts => ({ kind: 'fraction', shape: 'circle', parts, shaded: parts / 3, ask: 'name' }))
    const calls = []
    const fetchChunk = vi.fn(async (_p, group, feedback) => {
      calls.push({ pages: group.map(g => g.pageNum), feedback: new Map(feedback) })
      return group.map(g => (g.pageNum === 9 ? p9Raw : calls.length === 1 ? p12Raw : { ...p12Raw, title: 'Thirds Equivalence', shapeItems: thirds }))
    })
    const { pages, failed } = await generateHybridPages(plan, [byNum(9), byNum(12)], { fetchChunk })
    expect(failed).toEqual([])
    expect(calls.map(c => c.pages)).toEqual([[9, 12], [12]])
    expect(calls[1].feedback.get(12)[0]).toMatch(/^repeats page 9: 5 of 5 items .*"fraction 2\/4"/)
    expect(pages.get(12).content.spec.items.map(i => `${i.shaded}/${i.parts}`)).toEqual(['1/3', '2/6', '3/9', '4/12'])
  })

  it('a page that stays a duplicate falls down the ladder (legacy), never ships twice', async () => {
    const fetchChunk = vi.fn(async (_p, group) => group.map(g => (g.pageNum === 9 ? p9Raw : p12Raw)))
    const { pages, failed } = await generateHybridPages(plan, [byNum(9), byNum(12)], { fetchChunk })
    expect([...pages.keys()]).toEqual([9])
    expect(failed.map(p => p.pageNum)).toEqual([12])
  })

  it('assignLayouts caps every layout at 40% of the run\'s 16 content pages (chart exempt)', () => {
    const cap = layoutCap(runPages.length)
    expect(cap).toBe(6)
    const assigned = assignLayouts(runPages)
    const counts = {}
    for (const l of assigned.values()) counts[l] = (counts[l] ?? 0) + 1
    for (const [l, c] of Object.entries(counts)) if (l !== 'chart') expect(c, l).toBeLessThanOrEqual(cap)
    expect(assigned.get(16)).toBe('chart')
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4)
    // Deterministic.
    expect([...assignLayouts(runPages)]).toEqual([...assigned])
  })

  it('surplus pages move to the least-used text layout', () => {
    const shapesOnly = [1, 2, 3, 4, 5, 6, 7, 8].map(n => planPage(n + 1, `Shade the Fractions ${n}`))
    const assigned = [...assignLayouts(shapesOnly).values()]
    expect(assigned.filter(l => l === 'shapes')).toHaveLength(3)
    expect(assigned.slice(3)).toEqual(['multiple_choice', 'fill_blank', 'matching', 'questions', 'sorting'])
  })

  it('the prompt carries the set-wide suggestion, and Groq picking an over-cap layout is re-asked', async () => {
    const five = [2, 3, 4, 5, 6].map(n => planPage(n, `Shade Fractions Part ${n}`))
    const suggested = assignLayouts(five)
    expect(buildHybridContentPrompt(plan, [five[3]], new Map(), suggested)).toContain('suggested layout: multiple_choice')
    // Groq ignores the suggestion and returns shapes for every page, each with different fractions.
    const shapesFor = (n) => ({ pageNum: n, title: `Shade ${n}`, layout: 'shapes', shapeItems: [2, 3, 4, 5].map(k => ({ kind: 'fraction', shape: 'bar', parts: k + n, shaded: n - 1, ask: 'shade' })) })
    const mc = (n) => ({ pageNum: n, title: 'Equivalent Fractions', layout: 'multiple_choice', questions: [1, 2, 3, 4].map(k => ({ num: k, question: `Which fraction equals ${k}/${n}?`, options: [`${2 * k}/${2 * n}`, `${k + 1}/${n + 3}`], answer: 'A' })) })
    const seen = []
    const fetchChunk = vi.fn(async (_p, group, feedback, _s, { suggested: sug }) => {
      seen.push({ pages: group.map(g => g.pageNum), fb: group.map(g => feedback.get(g.pageNum)?.[0] ?? null), sug })
      return group.map(g => (feedback.get(g.pageNum) ? mc(g.pageNum) : shapesFor(g.pageNum)))
    })
    const { pages, failed } = await generateHybridPages(plan, five, { fetchChunk })
    expect(failed).toEqual([])
    expect(seen[0].sug).toBeInstanceOf(Map)
    const layouts = [2, 3, 4, 5, 6].map(n => pages.get(n).content.layout)
    expect(layouts.filter(l => l === 'shapes')).toHaveLength(3)
    expect(seen.map(s => s.pages)).toEqual([[2, 3, 4], [5, 6], [5, 6]])
    expect(seen[2].fb.every(f => /already has 3 shapes pages \(max 3\) — use the \w+ layout/.test(f))).toBe(true)
  })
})

describe('group 3 — FLUX subjects never invite writing', () => {
  it('removes chalkboards, equations and numbers from the run\'s kind of cover prompt', () => {
    const cover = { ...plan, pages: [{ type: 'cover', imagePrompt: "Bright cover with the title 'Fraction Equivalence' and a cartoon owl teacher at a chalkboard showing 2/4 = 1/2, with pizza slices and apples." }] }
    const p = buildIllustrationPrompt(cover)
    expect(p).not.toMatch(/chalkboard showing|2\/4|=|\d/)
    expect(p).toContain('owl teacher')
    expect(p).toContain('pizza slices')
    expect(p.startsWith(`cute flat-color children's book illustration, bright colors, clean outlines, white background, vignette composition centered on white, ${NO_TEXT}. `)).toBe(true)
    expect(p.endsWith(NO_TEXT)).toBe(true)
  })

  it('a cover with nothing but writing falls back to concrete topic objects', () => {
    const cover = { ...plan, pages: [{ type: 'cover', imagePrompt: 'A whiteboard with equations and number lines.' }] }
    expect(coverSubjects(cover)).toBe('a cheerful scene of a round pizza cut into equal slices, an orange cut into segments and a pie')
  })

  it('page subjects from abstract titles become topic objects, not random animals or "=" signs', () => {
    for (const t of ['Equivalent Fraction Matching', 'Identifying Equivalent Fractions Multiple Choice', 'Comparing Fractions Sorting']) {
      expect(pageIllustrationSubject(plan, { content: { title: t } })).toBe(topicObjects('fraction'))
    }
  })

  it('a Groq illustrationSubject with writing objects is cleaned (run page 8)', () => {
    expect(pageIllustrationSubject(plan, { content: { title: 'x', illustrationSubject: 'a ruler and a pencil drawing lines' } })).toBe('a pencil drawing lines')
    expect(pageIllustrationSubject(plan, { content: { title: 'x', illustrationSubject: 'pizza cut into different slices' } })).toBe('pizza cut into different slices')
  })

  it('textFreeSubject keeps subjects and drops writing carriers', () => {
    expect(textFreeSubject('a cat reading a book under a tree')).toBe('a cat under a tree')
    expect(textFreeSubject('children holding signs with numbers')).toBe('children')
    expect(textFreeSubject('a smiling squirrel holding an acorn')).toBe('a smiling squirrel holding an acorn')
    expect(textFreeSubject('Sun, Earth, Mars and Saturn with its rings. Show no other planets.')).toBe('Sun, Earth, Mars and Saturn with its rings. Show no other planets.')
    expect(textFreeSubject('fraction circles and fraction strips')).toBe('')
    expect(textFreeSubject('½ of a pie = 2/4')).toBe('a pie')
  })

  it('page and colouring prompts are cleaned too, with the strong no-text directive', () => {
    const p = buildPageIllustrationPrompt('a teacher at a whiteboard with equations')
    expect(p).not.toMatch(/whiteboard|equations\b(?!, no)/)
    expect(p).toContain('. a teacher. ')
    expect(buildPageIllustrationPrompt('a blackboard')).toContain('pencils, crayons and an apple')
    expect(buildColoringPrompt('a fox holding a sign')).toContain('. a fox. ')
    expect(NO_TEXT).toMatch(/no equations, no writing, no chalkboard writing, no signs, no labels/)
  })
})

describe('brainstorm hybrid-only planning note', () => {
  const validPlan = () => {
    const pages = [{ pageNum: 1, type: 'cover', filename: 'cover', imagePrompt: 'A cover showing a red apple.' }]
    for (let i = 0; i < 10; i++) pages.push({ pageNum: i + 2, type: 'worksheet', filename: `ws_${i + 1}`, imagePrompt: 'A page with five addition problems.' })
    return { setTitle: 'Apple Addition', pages, tptListing: { title: 'Apple Addition | Grade 1', description: 'Fun set.', subjectAreas: ['Arithmetic'], tags: ['Worksheets', 'Printables'], teachingDuration: '30 minutes', keywords: [] } }
  }
  const promptFor = async (env) => {
    const create = vi.fn().mockResolvedValue({ usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'generate_worksheet_plan', arguments: JSON.stringify(validPlan()) } }] } }] })
    await brainstorm('Grade 1', 30, [], 'small', 'May', { client: { chat: { completions: { create } } }, env })
    return create.mock.calls[0][0].messages[0].content
  }

  it('tells hybrid-only brainstorm what code can print; the default prompt is unchanged', async () => {
    const hybrid = await promptFor({ PAGE_RENDERER: 'hybrid-only', BRAINSTORM_PROVIDER: 'groq' })
    expect(hybrid).toMatch(/Never plan number lines, clocks, rulers/)
    const def = await promptFor({ BRAINSTORM_PROVIDER: 'groq' })
    expect(def).not.toMatch(/typeset by code/)
  })
})
