import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchingIssues, sortingIssues, normalizeHybridPage, validateHybridPage, buildHybridContentPrompt,
  matchingAmbiguity, buildMatchingCheckPrompt, selfCheckMatching, matchingSelfCheckEnabled, matchingSolveTool,
  dropPairs, generateHybridPages, generateHybridContent, HYBRID_MAX_ATTEMPTS, numericValue,
} from '../src/steps/hybrid-content.js'
import { matchingOrder, LETTERS } from '../src/lib/layout/specs.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'
import { solarPlan as plan, ringsPage, ringsPageReworded, fixedPage, RINGED } from './fixtures/ambiguous-matching.js'

const opts = { packageType: 'small' }
const spec = (raw) => normalizeHybridPage(raw).spec
const page = { pageNum: 6, type: 'worksheet', filename: 'planet-match', imagePrompt: 'Match each planet to its fact' }

/** Letter the page prints for pair j. */
const letterOf = (sp, j) => LETTERS[matchingOrder(sp).indexOf(j)]
/**
 * A careful mock self-check: each statement best describes its own term, and a
 * statement about rings (other than the "largest, brightest ring system"
 * superlative) is also true of every other ringed planet.
 */
const truthSolver = vi.fn(async (_plan, sp) => ({
  statements: matchingOrder(sp).map((j, k) => {
    const rings = /rings/i.test(sp.pairs[j].match) && !/largest/i.test(sp.pairs[j].match)
    const also = rings ? sp.pairs.map((p, t) => (t !== j && RINGED.includes(p.term) ? t + 1 : 0)).filter(Boolean) : []
    return { letter: LETTERS[k], best: j + 1, alsoTrueFor: also }
  }),
}))
/** Self-check answer from { pairIndex: [best, ...also] } (1-based terms), the rest unambiguous. */
const answer = (sp, over = {}) => ({ statements: matchingOrder(sp).map((j, k) => { const [best, ...also] = over[j] ?? [j + 1]; return { letter: LETTERS[k], best, alsoTrueFor: also } }) })

describe('prompt rules (hybrid only)', () => {
  it('names the one-true-term rule, the shared-property ban and the planets example', () => {
    const p = buildHybridContentPrompt(plan, [page])
    expect(p).toContain('TRUE for its own term and FALSE for every other term')
    expect(p).toMatch(/never a property several of the terms share \("has rings", "is a mammal", "lives in water"/)
    expect(p).toContain('Bad (planets): Saturn – "Has a system of rings"')
    expect(p).toContain('Mercury – "Closest planet to the Sun"')
    expect(p).toContain('a match never contains its own term')
  })
})

describe('code checks', () => {
  it('rejects the real rings page with feedback naming the pair', () => {
    const issues = validateHybridPage(normalizeHybridPage(ringsPage), opts)
    expect(issues).toEqual(['"Has a system of rings" (for "Saturn") is a property several items share — use a fact true only for "Saturn"'])
    expect(validateHybridPage(normalizeHybridPage(fixedPage), opts)).toEqual([])
  })

  it('flags a match that contains its own term (also plural), but not substrings', () => {
    expect(matchingIssues([{ term: 'Root', match: 'Roots take in water' }])).toEqual(['the match for "Root" contains the term itself — it gives the answer away'])
    expect(matchingIssues([{ term: 'Sun', match: 'Plants need sunlight to grow' }])).toEqual([])
    expect(matchingIssues([{ term: 'Water cycle', match: 'How water moves around Earth' }])).toEqual([])
  })

  it('flags near-duplicate matches (punctuation / articles) that the exact-duplicate rule misses', () => {
    const issues = matchingIssues([{ term: 'Jupiter', match: 'The largest planet.' }, { term: 'Saturn', match: 'Largest planet' }])
    expect(issues).toEqual(['"Saturn" and "Jupiter" have the same match ("Largest planet") — give each term a different fact'])
  })

  it('flags bare vague properties only, not facts that merely mention them', () => {
    for (const m of ['Is big', 'It is very important.', 'Has rings', 'They have a ring system']) expect(matchingIssues([{ term: 'X', match: m }]), m).toHaveLength(1)
    for (const m of ['Is a mammal', 'Largest planet with rings', 'Is bigger than all other planets', 'Has rings you can see with a small telescope']) expect(matchingIssues([{ term: 'X', match: m }]), m).toEqual([])
  })

  it('sorting: a word filed under two categories is kept by normalize and rejected; a word equal to a heading is rejected', () => {
    const n = normalizeHybridPage({ layout: 'sorting', categories: ['Mammals', 'Birds'], sortItems: [
      { word: 'bat', category: 'Mammals' }, { word: 'bat', category: 'Birds' }, { word: 'dog', category: 'Mammals' }, { word: 'robin', category: 'Birds' }, { word: 'owl', category: 'Birds' },
    ] })
    expect(n.spec.items).toHaveLength(5)
    expect(validateHybridPage(n, opts)).toContain('sort word "bat" is listed under "Mammals" and "Birds" — each word must fit exactly one category')
    expect(sortingIssues({ categories: ['Fruit', 'Vegetable'], items: [{ word: 'fruit', category: 'Fruit' }] })).toEqual(['sort word "fruit" is also a category heading'])
  })
})

describe('self-check analysis', () => {
  it('prompt shows terms and the printed (shuffled) statements, never the key', () => {
    const sp = spec(ringsPageReworded)
    const p = buildMatchingCheckPrompt(plan, sp)
    expect(p).toContain('1. Mercury')
    expect(p).toContain(`${letterOf(sp, 0)}. Closest planet to the Sun`)
    expect(p).not.toMatch(/Mercury[^\n]*Closest/)
    expect(p).toContain('not by elimination')
    const item = matchingSolveTool.function.parameters.properties.statements.items
    expect(item.required).toEqual(['letter', 'best', 'alsoTrueFor'])
    // term numbers accept "3" as well as 3, so a stringified number never 400s the call
    expect(item.properties.best.anyOf.map(a => a.type)).toEqual(['integer', 'string'])
  })

  it('flags a meaning that fits several terms and names them', async () => {
    const sp = spec(ringsPageReworded)
    const r = matchingAmbiguity(sp, await truthSolver(plan, sp))
    expect(r.ambiguous).toBe(true)
    expect(r.offending).toEqual([5])
    expect(r.issues[0]).toBe('ambiguous: the match "Has beautiful rings made of ice and rock" (for "Saturn") is also true for "Jupiter", "Uranus", "Neptune" — use a fact true only for "Saturn"')
  })

  it('flags a statement matched to another term; accepts string numbers, term names and "2, 3"; incomplete answers are unusable', () => {
    const sp = spec(fixedPage)
    const r = matchingAmbiguity(sp, answer(sp, { 1: [1] }))
    expect(r.offending).toEqual([1])
    expect(r.issues).toEqual(['ambiguous: a checker matched "Hottest planet in our solar system" to "Mercury", not "Venus" — use a fact true only for "Venus"'])
    const strs = answer(sp, { 2: ['3', '4', 'Mars'] })
    strs.statements = strs.statements.map(x => (x.best === '3' ? { ...x, alsoTrueFor: '4, 5' } : x))
    expect(matchingAmbiguity(sp, strs).issues).toEqual(['ambiguous: the match "Only planet known to have life" (for "Earth") is also true for "Mars", "Jupiter" — use a fact true only for "Earth"'])
    expect(matchingAmbiguity(sp, answer(sp))).toMatchObject({ valid: true, ambiguous: false, issues: [] })
    expect(matchingAmbiguity(sp, { statements: [{ letter: 'A', best: 1, alsoTrueFor: [] }] })).toEqual({ valid: false })
  })

  it('dropPairs keeps the rest only if ≥3 pairs remain', () => {
    const sp = spec(ringsPageReworded)
    expect(dropPairs(sp, [5]).pairs.map(p => p.term)).not.toContain('Saturn')
    expect(dropPairs({ pairs: sp.pairs.slice(0, 4) }, [0, 1])).toBeNull()
  })

  it('MATCHING_SELF_CHECK=off disables it; a failed call is reported as an error (fail-open)', async () => {
    expect(matchingSelfCheckEnabled({})).toBe(true)
    expect(matchingSelfCheckEnabled({ MATCHING_SELF_CHECK: 'off' })).toBe(false)
    expect(matchingSelfCheckEnabled({ MATCHING_SELF_CHECK: 'OFF ' })).toBe(false)
    const r = await selfCheckMatching(plan, spec(fixedPage), { solve: async () => { throw Object.assign(new Error('x'), { status: 429 }) } })
    expect(r).toEqual({ error: '429' })
    expect(await selfCheckMatching(plan, spec(fixedPage), { solve: async () => null })).toEqual({ error: 'answer did not cover every term' })
  })
})

describe('generateHybridPages with the self-check (Groq mocked)', () => {
  beforeEach(() => { resetReviewNotes(); truthSolver.mockClear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('an ambiguous matching page is re-asked with the offending pair named, then passes', async () => {
    const seen = []
    const fetchChunk = vi.fn(async (_p, group, feedback) => { seen.push(new Map(feedback)); return [seen.length === 1 ? ringsPageReworded : fixedPage] })
    const stats = { calls: [], pages: [] }
    const { pages, failed } = await generateHybridPages(plan, [page], { fetchChunk, solveMatching: truthSolver, stats })
    expect(fetchChunk).toHaveBeenCalledTimes(2)
    expect(truthSolver).toHaveBeenCalledTimes(2) // one extra call per validated matching page
    expect(seen[1].get(6)[0]).toMatch(/^ambiguous: the match "Has beautiful rings made of ice and rock" \(for "Saturn"\) is also true for "Jupiter"/)
    expect(stats.pages.map(p => p.issues.length > 0)).toEqual([true, false])
    expect(failed).toEqual([])
    expect(pages.get(6).content.spec.pairs[5].match).toBe('Planet with the largest, brightest ring system')
  })

  it('code-rejected pages never reach the self-check', async () => {
    const fetchChunk = vi.fn(async () => [ringsPage])
    await generateHybridPages(plan, [page], { fetchChunk, solveMatching: truthSolver })
    expect(fetchChunk).toHaveBeenCalledTimes(HYBRID_MAX_ATTEMPTS)
    expect(truthSolver).not.toHaveBeenCalled()
  })

  it('still ambiguous after every attempt → the offending pairs are dropped (≥3 remain) with a review note', async () => {
    const fetchChunk = vi.fn(async () => [ringsPageReworded])
    const { pages, failed } = await generateHybridPages(plan, [page], { fetchChunk, solveMatching: truthSolver })
    expect(fetchChunk).toHaveBeenCalledTimes(HYBRID_MAX_ATTEMPTS)
    expect(failed).toEqual([])
    const c = pages.get(6).content
    expect(c.spec.pairs.map(p => p.term)).toEqual(['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Uranus', 'Neptune'])
    expect(c.questions).toHaveLength(7)
    expect(reviewNotes().some(n => n.kind === 'fallback' && /p6: matching stayed ambiguous .* dropped "Saturn"; 7 pairs remain/.test(n.message))).toBe(true)
  })

  it('too few pairs left after dropping → falls back like any failure (legacy list)', async () => {
    const small = { ...ringsPageReworded, pairs: [ringsPageReworded.pairs[4], ringsPageReworded.pairs[5], ringsPageReworded.pairs[6]] }
    const solve = async (_p, sp) => answer(sp, Object.fromEntries(sp.pairs.map((_, j) => [j, [j + 1, 1, 2, 3]])))
    const { pages, failed } = await generateHybridPages(plan, [page], { fetchChunk: async () => [small], solveMatching: solve })
    expect(pages.size).toBe(0)
    expect(failed.map(p => p.pageNum)).toEqual([6])
  })

  it('MATCHING_SELF_CHECK=off skips the extra call', async () => {
    vi.stubEnv('MATCHING_SELF_CHECK', 'off')
    const { pages } = await generateHybridPages(plan, [page], { fetchChunk: async () => [ringsPageReworded], solveMatching: truthSolver })
    expect(truthSolver).not.toHaveBeenCalled()
    expect(pages.get(6).content.spec.pairs).toHaveLength(8)
  })

  it('a failed self-check call keeps the page (fail-open) with a review note', async () => {
    const solve = vi.fn(async () => { throw Object.assign(new Error('rate limited'), { status: 429 }) })
    const fetchChunk = vi.fn(async () => [fixedPage])
    const { pages, failed } = await generateHybridPages(plan, [page], { fetchChunk, solveMatching: solve })
    expect(fetchChunk).toHaveBeenCalledOnce()
    expect(solve).toHaveBeenCalledOnce()
    expect(failed).toEqual([])
    expect(pages.get(6).content.layout).toBe('matching')
    expect(reviewNotes()).toEqual([{ kind: 'fallback', message: 'p6: matching self-check failed (429) — check that every meaning fits only one term' }])
  })

  it('generateHybridContent passes the solver through; non-matching pages get no self-check', async () => {
    const mc = { pageNum: 7, title: 'Quiz', layout: 'multiple_choice', questions: [1, 2, 3, 4].map(i => ({ num: i, question: `Which planet is number ${i} from the Sun?`, options: ['Mercury', 'Venus', 'Earth', 'Mars'], answer: LETTERS[i - 1] })) }
    const fetchChunk = async (_p, group) => group.map(g => (g.pageNum === 6 ? fixedPage : mc))
    const out = await generateHybridContent(plan, [page, { ...page, pageNum: 7 }], { fetchChunk, solveMatching: truthSolver, check: async () => ({ pass: true, corrections: [] }), legacy: async () => [] })
    expect(truthSolver).toHaveBeenCalledOnce()
    expect(out.get(6).layout).toBe('matching')
    expect(out.get(7).layout).toBe('multiple_choice')
  })
})

describe('numbers and fractions (self-check false positives)', () => {
  const fractions = spec({ layout: 'matching', pairs: [
    { term: '1/2', match: 'one half' }, { term: '1/3', match: 'one third' },
    { term: '3/4', match: 'three quarters' }, { term: '2/5', match: 'two-fifths' },
  ] })
  const j = (term) => fractions.pairs.findIndex(p => p.term === term)

  it('numericValue reads numerals, fractions and number words; other text is null', () => {
    expect(numericValue('one third')).toBeCloseTo(1 / 3)
    expect(numericValue('1/2')).toBe(0.5)
    expect(numericValue('two-fifths')).toBeCloseTo(0.4)
    expect(numericValue('a half')).toBe(0.5)
    expect(numericValue('½')).toBe(0.5)
    expect(numericValue('1 1/2')).toBe(1.5)
    expect(numericValue('3 out of 4 equal parts')).toBe(0.75)
    expect(numericValue('twenty-one')).toBe(21)
    expect(numericValue('50%')).toBe(0.5)
    for (const x of ['1/3 of a pizza', 'less than one half', 'Saturn', 'a', 'Has rings', '']) expect(numericValue(x), x).toBeNull()
  })

  it('code checks pass a page of distinct fraction values', () => {
    expect(matchingIssues(fractions.pairs)).toEqual([])
    expect(validateHybridPage(normalizeHybridPage({ layout: 'matching', pairs: fractions.pairs }), opts)).toEqual([])
    expect(matchingIssues([{ term: '12', match: 'twelve' }, { term: '20', match: 'twenty' }, { term: '21', match: 'twenty-one' }])).toEqual([])
  })

  it('ignores a self-check claim that "one third" also fits "1/2" (different values)', () => {
    const r = matchingAmbiguity(fractions, answer(fractions, { [j('1/3')]: [j('1/3') + 1, j('1/2') + 1] }))
    expect(r).toMatchObject({ valid: true, ambiguous: false, offending: [] })
    // and a checker that matched "one third" to "1/2" outright is overruled too
    const r2 = matchingAmbiguity(fractions, answer(fractions, { [j('1/3')]: [j('1/2') + 1] }))
    expect(r2.ambiguous).toBe(false)
  })

  it('still flags equal values: equivalent fractions in code, and a self-check claim between equal values', () => {
    const eq = [{ term: '1/2', match: 'one half' }, { term: '2/4', match: 'two fourths' }, { term: '1/3', match: 'one third' }]
    expect(matchingIssues(eq)).toEqual([
      '"one half" and "two fourths" are the same number — every match must be a different value',
      '"1/2" and "2/4" are the same number — every term must be a different value',
    ])
    const sp = spec({ layout: 'matching', pairs: [...eq, { term: '3/4', match: 'three quarters' }] })
    const half = sp.pairs.findIndex(p => p.term === '1/2')
    const quarters = sp.pairs.findIndex(p => p.term === '2/4')
    const r = matchingAmbiguity(sp, answer(sp, { [half]: [half + 1, quarters + 1] }))
    expect(r.offending).toEqual([half])
  })

  it('non-numeric statements on a number page are still judged by the self-check', () => {
    const sp = spec({ layout: 'matching', pairs: [
      { term: '1/2', match: 'Less than one whole' }, { term: '1/3', match: 'one third' },
      { term: '3/4', match: 'three quarters' }, { term: '2/5', match: 'two-fifths' },
    ] })
    const k = sp.pairs.findIndex(p => p.term === '1/2')
    const r = matchingAmbiguity(sp, answer(sp, { [k]: [k + 1, sp.pairs.findIndex(p => p.term === '1/3') + 1] }))
    expect(r.offending).toEqual([k])
  })

  it('real ambiguities are unchanged: "has rings" is rejected in code and by the self-check', async () => {
    expect(matchingIssues([{ term: 'Saturn', match: 'Has rings' }])).toHaveLength(1)
    const sp = spec(ringsPageReworded)
    expect(matchingAmbiguity(sp, await truthSolver(plan, sp)).ambiguous).toBe(true)
  })
})

