import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeHybridPage, validateHybridPage, generateHybridPages, buildHybridContentPrompt,
  isPictureDetailTask, isPictureDependent, repairActivityArt, normalizeChart, sameCategory, sortingHint,
} from '../src/steps/hybrid-content.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'
import { activityArtCollar, chartVariants, chartGood, sortingPlantStringCats, sortingPlantNoCats, sortingFigurative } from './fixtures/hybrid-observed-failures.js'

const plan = { setTitle: 'Test Set', gradeLevel: 'Grade 2', subject: 'Science', packageType: 'small', themeColor: '#2E7D32', pageCount: 12 }
const page = (pageNum, filename, imagePrompt, type = 'worksheet') => ({ pageNum, type, filename, imagePrompt })
const opts = (p = page(2, 'x', '')) => ({ packageType: 'small', plan, page: { ...p, title: 'T' } })
const issuesOf = (raw) => validateHybridPage(normalizeHybridPage(raw), opts())

beforeEach(() => resetReviewNotes())

describe('activity_art: tasks must work on any picture', () => {
  it('flags tasks that name a drawn detail, a part colour, an object drawn on it, or an unstated count', () => {
    for (const t of ["Color the cat's collar blue", "Colour the bee's wings.", 'Colour the wings of the butterfly.', 'Colour the spots on the ladybug.', 'Draw a hat on the cat.', 'Use blue for the sky.', 'Count the spots on the cat.', 'How many petals are there?']) {
      expect(isPictureDetailTask(t), t).toBe(true)
    }
    for (const t of ['Colour the picture.', 'Colour the biggest thing.', 'Write one word about the picture.', 'Draw 3 stars around it.', 'Write the word cat three times.', 'Count to 10 and write the numbers.', 'Colour the background.', 'Draw a sun in the sky.', 'Colour the picture of the cat.']) {
      expect(isPictureDetailTask(t), t).toBe(false)
    }
  })

  it('the stricter check is activity_art only (questions pages keep isPictureDependent)', () => {
    expect(isPictureDependent('How many legs does a spider have?')).toBe(false)
    const q = normalizeHybridPage({ layout: 'questions', questions: ["What colour is a zebra's mane?", 'What is 2+2?', 'What is 3+3?', 'What is 4+4?'].map((question, i) => ({ num: i + 1, question, answer: '1' })) })
    expect(validateHybridPage(q, opts())).toEqual([])
  })

  it('observed failure: rejected with the any-picture hint first, naming each bad task', () => {
    const issues = issuesOf(activityArtCollar)
    expect(issues[0]).toMatch(/^activity_art tasks must work on ANY picture of the subject .*"Colour the biggest thing\."/)
    expect(issues).toContain('task 2 depends on the picture: "Color the cat\'s collar blue"')
    expect(issues).toContain('task 3 depends on the picture: "Count the spots on the cat."')
    expect(issues.some(i => i.startsWith('task 1'))).toBe(false)
  })

  it('repairActivityArt drops only the bad tasks and resets a bad instruction', () => {
    const n = repairActivityArt(normalizeHybridPage({ ...activityArtCollar, instruction: 'Colour the cat\'s tail orange.' }))
    expect(n.spec.tasks).toEqual(['Write the word cat three times.'])
    expect(n.spec.instruction).toBe('Colour the picture.')
    expect(n.repairs.at(-1)).toMatch(/dropped 2 task\(s\) and replaced the instruction/)
    expect(validateHybridPage(n, opts())).toEqual([])
    expect(repairActivityArt(normalizeHybridPage({ ...activityArtCollar, tasks: ['Write the word cat.'] }))).toBeNull()
  })

  it('retry carries the hint; a page still failing after every attempt ships repaired, not as legacy', async () => {
    const seen = []
    const fetchChunk = async (_p, _g, feedback) => { seen.push(feedback.get(5)); return [activityArtCollar] }
    const { pages, failed } = await generateHybridPages(plan, [page(5, 'colour-cat', 'Colouring page: a cat', 'activity')], { fetchChunk })
    expect(failed).toEqual([])
    expect(seen[1][0]).toMatch(/ANY picture/)
    const c = pages.get(5).content
    expect(c.layout).toBe('activity_art')
    expect(c.spec.tasks).toEqual(['Write the word cat three times.'])
    expect(reviewNotes().some(r => /activity_art tasks kept naming details/.test(r.message ?? r.text ?? JSON.stringify(r)))).toBe(true)
  })

  it('prompt states the any-picture rule with examples', () => {
    const p = buildHybridContentPrompt(plan, [page(5, 'colour-cat', 'Colouring page: a cat', 'activity')])
    expect(p).toMatch(/every task must work on ANY picture of the subject/)
    expect(p).toMatch(/Colour the cat's collar blue/)
  })
})

describe('chart: chart object recovered or re-asked with its exact shape', () => {
  it.each(Object.entries(chartVariants).filter(([k]) => k !== 'missing'))('%s → a valid chart', (_k, raw) => {
    const n = normalizeHybridPage(raw)
    expect(validateHybridPage(n, opts())).toEqual([])
    expect(n.spec.chart.categories.every(c => Number.isInteger(c.value))).toBe(true)
  })

  it('normalizes types, lifts page-level data and notes it; over-limit untyped chart becomes a table', () => {
    expect(normalizeChart(chartVariants.aliasMap).chart).toMatchObject({ type: 'bar', title: 'Favourite Fruit', categories: [{ label: 'Apples', value: 5 }, { label: 'Bananas', value: 3 }, { label: 'Pears', value: 2 }] })
    const l = normalizeHybridPage(chartVariants.lifted)
    expect(l.spec.chart).toMatchObject({ type: 'pictograph', icon: 'star' })
    expect(l.repairs.join()).toMatch(/moved into it/)
    const t = normalizeHybridPage(chartVariants.noTypeOverLimit)
    expect(t.spec.chart.type).toBe('table')
    expect(t.repairs.join()).toMatch(/type missing.*bar/)
    expect(t.repairs.join()).toMatch(/drawn as a table/)
    expect(normalizeChart({ layout: 'chart', chart: null })).toBeNull()
    expect(normalizeChart({ layout: 'chart', chart: 'not json' })).toBeNull()
  })

  it('observed failure "chart missing": hint first, with the exact shape and limits', () => {
    const issues = issuesOf(chartVariants.missing)
    expect(issues[0]).toMatch(/^chart missing — return "chart": \{"type": "pictograph" \| "bar" \| "table".*"categories": \[\{"label": "Apples", "value": 4\}.*whole-number values \(pictograph ≤6 categories and ≤12, bar ≤6 and ≤20, table ≤8 rows\)/)
    const bad = issuesOf({ ...chartGood, chart: { type: 'pie', categories: [] } })
    expect(bad[0]).toMatch(/chart type "pie"/)
    expect(bad[1]).toMatch(/^chart must be "chart": \{"type"/)
  })

  it('retry: a chart page without a chart is re-asked with the shape, then ships the code-drawn chart', async () => {
    const seen = []
    let call = 0
    const fetchChunk = async (_p, _g, feedback) => { seen.push(feedback.get(4)); return [call++ ? chartGood : chartVariants.missing] }
    const { pages, failed } = await generateHybridPages(plan, [page(4, 'fruit-graph', 'A picture graph of favourite fruit')], { fetchChunk })
    expect(failed).toEqual([])
    expect(seen[1][0]).toMatch(/^chart missing — return "chart"/)
    expect(pages.get(4).content.chart.type).toBe('pictograph')
  })
})

describe('sorting: categories normalized, leftovers dropped, precise hint', () => {
  it('sameCategory: case, spacing, punctuation and plural only', () => {
    expect(sameCategory('Similes', 'simile')).toBe(true)
    expect(sameCategory(' Living  Things ', 'living thing')).toBe(true)
    expect(sameCategory('Classes', 'class')).toBe(true)
    expect(sameCategory('Butterflies', 'butterfly')).toBe(true)
    expect(sameCategory('Simile', 'Metaphor')).toBe(false)
    expect(sameCategory('Living', 'Living Things')).toBe(false)
  })

  it('observed Gemini failure: a "Seed, Sprout, Flower" string is the heading list; plural/case item categories map onto it', () => {
    const n = normalizeHybridPage(sortingPlantStringCats)
    expect(n.spec.categories).toEqual(['Seed', 'Sprout', 'Flower'])
    expect(n.spec.items.map(i => i.category)).toEqual(['Seed', 'Seed', 'Sprout', 'Sprout', 'Flower', 'Flower'])
    expect(n.repairs.join()).toMatch(/matched to the listed heading/)
    expect(validateHybridPage(n, opts())).toEqual([])
  })

  it('no heading list: the items\' categories are used when they form a valid set', () => {
    const n = normalizeHybridPage(sortingPlantNoCats)
    expect(n.spec.categories).toEqual(['Seeds', 'Sprouts', 'Flowers'])
    expect(validateHybridPage(n, opts())).toEqual([])
    // one category used once → not a valid set → re-asked with the empty-list hint first
    const bad = normalizeHybridPage({ layout: 'sorting', sortItems: [{ word: 'dog', category: 'Living' }, { word: 'cat', category: 'Living' }, { word: 'rock', category: 'Nonliving' }] })
    expect(bad.spec.categories).toEqual([])
    expect(validateHybridPage(bad, opts())[0]).toMatch(/^sorting: "categories" was empty — return 2–3 column headings as a list of strings/)
  })

  it('category → words map and [{category, words}] shapes are read as items', () => {
    const a = normalizeHybridPage({ layout: 'sorting', categories: ['Living', 'Nonliving'], sortItems: { Living: ['dog', 'tree', 'bird'], Nonliving: ['rock', 'cup', 'chair'] } })
    expect(a.spec.items).toHaveLength(6)
    const b = normalizeHybridPage({ layout: 'sorting', categories: [{ name: 'Living' }, { name: 'Nonliving' }], sortItems: [{ category: 'Living', words: ['dog', 'tree', 'bird'] }, { category: 'nonliving', words: ['rock', 'cup', 'chair'] }] })
    expect(b.spec.categories).toEqual(['Living', 'Nonliving'])
    expect(validateHybridPage(b, opts())).toEqual([])
  })

  it('observed Groq failure: plurals re-filed, unlisted categories and sentences dropped when ≥6 good remain', () => {
    const n = normalizeHybridPage(sortingFigurative)
    expect(n.spec.items.map(i => i.word)).toEqual(['as busy as a bee', 'time is money', 'as cold as ice', 'a night owl', 'like a rocket', 'a heart of gold'])
    expect(n.spec.items.map(i => i.category)).toEqual(['Simile', 'Metaphor', 'Simile', 'Metaphor', 'Simile', 'Metaphor'])
    expect(validateHybridPage(n, opts())).toEqual([])
  })

  it('too few good items: hint first, with the exact list and 2 good / 2 bad examples from the page', () => {
    const raw = { ...sortingFigurative, sortItems: sortingFigurative.sortItems.slice(0, 5) }
    const issues = issuesOf(raw)
    expect(issues[0]).toBe(sortingHint(normalizeHybridPage(raw).spec))
    expect(issues[0]).toMatch(/exactly one of "Simile", "Metaphor"/)
    expect(issues[0]).toMatch(/Good: \{"word": "as busy as a bee", "category": "Simile"\}, \{"word": "time is money", "category": "Metaphor"\}\./)
    expect(issues[0]).toMatch(/Bad: \{"word": "The wind whispered.*\(a sentence, not 1–3 words.*\{"word": "the leaves danced", "category": "Personification"\} \(category not in the list\)$/)
  })
})
