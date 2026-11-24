import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  suggestLayout, buildHybridContentPrompt, hybridContentTool, normalizeHybridPage, validateHybridPage,
  isPictureDependent, readsOtherPageContent, hybridPageContent, questionsFallback, generateHybridPages,
  generateHybridContent, recheckItems, applyHybridCorrections, HYBRID_PAGES_PER_CALL,
} from '../src/steps/hybrid-content.js'
import { layoutAnswerKey, shapeItemQA } from '../src/lib/layout/specs.js'
import { structuredRoute, generateWorksheetPage, routePage } from '../src/steps/generate-pages.js'
import { renderHybridPage } from '../src/lib/hybrid-page.js'
import { pageIllustrationSubject } from '../src/lib/illustrations.js'
import { answerKeySvg } from '../src/lib/svg-templates.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'
import { stubIllustration } from './helpers/stub-art.js'

const plan = { setTitle: 'Spring Plant Life Cycle', gradeLevel: 'Grade 2', subject: 'Science', packageType: 'small', themeColor: '#2E7D32', pageCount: 12 }
const page = (pageNum, filename, imagePrompt, type = 'worksheet') => ({ pageNum, type, filename, imagePrompt })
const opts = (p = page(2, 'x', '')) => ({ packageType: 'small', plan, page: { ...p, title: 'T' } })

const raw = {
  matching: { pageNum: 2, title: 'Plant Words', layout: 'matching', illustrationSubject: 'a sprouting bean seed', pairs: [
    { term: 'Seed', match: 'A tiny part that grows into a new plant' },
    { term: 'Root', match: 'Takes in water from the soil' },
    { term: 'Leaf', match: 'Makes food for the plant using sunlight' },
    { term: 'Stem', match: 'Holds the plant up' },
  ], questions: null, chart: null, wordBank: '' },
  mc: { pageNum: 3, title: 'Plant Needs', layout: 'multiple_choice', questions: [
    { num: 1, question: 'What do plants need to make food?', options: ['A) Sunlight', 'B) Sand', 'C) Plastic'], answer: 'A) Sunlight' },
    { num: 2, question: 'Which part takes in water?', options: ['Leaf', 'Root', 'Flower', 'Root'], answer: 'root' },
    { num: 3, question: 'What falls from the sky and waters plants?', options: ['Rain', 'Sand'], answer: 'A' },
    { num: 4, question: 'Which gas do plants take in from the air?', options: ['Carbon dioxide', 'Helium'], answer: 'Carbon dioxide' },
  ] },
  fill: { pageNum: 4, title: 'Fill In', layout: 'fill_blank', wordBank: ['seed', 'Seed', null], sentences: [
    { num: 1, sentence: 'A plant grows from a ___.', answer: 'seed' },
    { num: 2, sentence: 'The roots drink water from the soil.', answer: 'soil' },
    { num: 3, sentence: 'Leaves need ___ to make food.', answer: 'sunlight' },
    { num: 4, sentence: 'A baby plant is called a ___.', answer: 'seedling' },
  ] },
}

describe('layout hint + prompt + schema (hybrid only)', () => {
  it('suggests a layout from the page description', () => {
    expect(suggestLayout(page(2, 'sort-word-families', 'Sort CVC words into columns'))).toBe('sorting')
    expect(suggestLayout(page(2, 'label-the-plant', 'Label the parts of a plant'))).toBe('labeling')
    expect(suggestLayout(page(2, 'x', 'A picture graph of favorite fruits'))).toBe('chart')
    expect(suggestLayout(page(2, 'one-more-table', 'A table to complete'))).toBe('table_fill')
    expect(suggestLayout(page(2, 'x', 'Shade the fraction of each shape'))).toBe('shapes')
    expect(suggestLayout(page(2, 'color-the-cat', 'A coloring page'))).toBe('activity_art')
    expect(suggestLayout(page(2, 'x', 'Word problems about apples'))).toBe('questions')
  })

  it('prompt names the decorative-picture rules and no imageSpec; schema has no imageSpec and accepts null on optional fields', () => {
    const p = buildHybridContentPrompt(plan, [page(2, 'x', 'Match words to meanings')], new Map([[2, ['pairs have duplicate matches']]]))
    expect(p).toContain('THE PICTURE IS DECORATION ONLY')
    expect(p).toContain('suggested layout: matching')
    expect(p).toContain('PREVIOUS ATTEMPT WAS REJECTED — fix: pairs have duplicate matches')
    expect(p).not.toMatch(/imageSpec/)
    const props = hybridContentTool.function.parameters.properties.pages.items.properties
    expect(props.imageSpec).toBeUndefined()
    expect(hybridContentTool.function.parameters.properties.pages.items.required).toEqual(['pageNum', 'title', 'layout'])
    for (const k of ['questions', 'pairs', 'chart', 'shapeItems', 'illustrationSubject']) {
      expect(props[k].anyOf.map(a => a.type)).toEqual(expect.arrayContaining(['null', 'string']))
    }
    // Enums inside optional fields are described, never enforced (Groq 400s the whole call).
    expect(JSON.stringify(props.shapeItems)).not.toContain('"enum"')
  })
})

describe('normalize + repair', () => {
  it('multiple choice: strips option letters, dedupes options, answers become letters', () => {
    const n = normalizeHybridPage(raw.mc)
    expect(n.spec.questions[0]).toEqual({ num: 1, question: 'What do plants need to make food?', options: ['Sunlight', 'Sand', 'Plastic'], answer: 'A' })
    expect(n.spec.questions[1].options).toEqual(['Leaf', 'Root', 'Flower'])
    expect(n.spec.questions[1].answer).toBe('B')
    expect(validateHybridPage(n, opts())).toEqual([])
  })

  it('fill_blank: puts a blank where the answer was printed, completes and dedupes the word bank, drops nulls', () => {
    const n = normalizeHybridPage(raw.fill)
    expect(n.questions[1].question).toBe('The roots drink water from the ___.')
    expect(n.spec.wordBank).toEqual(['seed', 'seedling', 'soil', 'sunlight'])
    expect(n.repairs.length).toBe(2)
    expect(validateHybridPage(n, opts())).toEqual([])
  })

  it('table cells in [brackets] become blanks; shapes counts are clamped; sorting categories match case-insensitively', () => {
    const t = normalizeHybridPage({ layout: 'table_fill', columns: ['Number', 'Double'], rows: [['2', '[4]'], ['3', '[6]'], ['5', '10']] })
    expect(t.spec.rows[0]).toEqual(['2', { answer: '4' }])
    expect(validateHybridPage(t, opts())).toEqual([])
    const sh = normalizeHybridPage({ layout: 'shapes', shapeItems: [{ kind: 'count', icon: 'star', count: 40 }, { kind: 'fraction', shape: 'circle', parts: 4, shaded: 9, ask: 'name' }, { kind: 'polygon', shape: 'circle', ask: 'sides' }] })
    expect(sh.spec.items).toEqual([{ kind: 'count', icon: 'star', count: 20 }, { kind: 'fraction', shape: 'circle', parts: 4, shaded: 4, ask: 'name' }, { kind: 'polygon', shape: 'circle', ask: 'name' }])
    const so = normalizeHybridPage({ layout: 'sorting', categories: ['Living', 'Nonliving'], sortItems: [{ word: 'dog', category: 'living' }, { word: 'rock', category: 'NONLIVING' }, { word: 'tree', category: 'Living' }, { word: 'cup', category: 'Nonliving' }, { word: 'Dog', category: 'Living' }] })
    expect(so.spec.items.map(i => i.category)).toEqual(['Living', 'Nonliving', 'Living', 'Nonliving'])
  })

  it('chart: "label: value" strings become categories; empty optional fields dropped', () => {
    const n = normalizeHybridPage({ layout: 'chart', chart: { type: 'bar', title: 'Pets', icon: '', categories: ['Dogs: 4', 'Cats - 6', { label: 'Fish', value: 2 }] }, questions: [1, 2, 3, 4].map(i => ({ num: i, question: `Q${i}?`, answer: '1' })) })
    expect(n.spec.chart.categories).toEqual([{ label: 'Dogs', value: 4 }, { label: 'Cats', value: 6 }, { label: 'Fish', value: 2 }])
    expect(n.spec.chart.icon).toBeUndefined()
    expect(validateHybridPage(n, opts())).toEqual([])
  })
})

describe('regressions from live Groq runs', () => {
  it('activity_art with its subject only in illustrationSubject is repaired, not retried', () => {
    const n = normalizeHybridPage({ pageNum: 5, title: 'Color the Cat', layout: 'activity_art', illustrationSubject: 'a big friendly cat sitting on a mat', subject: null, instruction: '', tasks: null })
    expect(n.spec).toEqual({ subject: 'a big friendly cat sitting on a mat', instruction: 'Colour the picture.' })
    expect(validateHybridPage(n, opts())).toEqual([])
  })

  it('schema tolerates what gpt-oss writes into unused fields (chart: {}, options: "", categories as strings)', () => {
    const props = hybridContentTool.function.parameters.properties.pages.items.properties
    const chart = props.chart.anyOf[0]
    expect(chart.required).toBeUndefined()
    expect(chart.properties.categories.items.anyOf.map(a => a.type)).toEqual(['object', 'string'])
    expect(props.questions.anyOf[0].items.properties.options.anyOf.map(a => a.type)).toEqual(['array', 'null', 'string'])
    // and the normaliser treats them as absent
    expect(normalizeHybridPage({ layout: 'matching', chart: {}, questions: '', pairs: raw.matching.pairs }).spec.pairs).toHaveLength(4)
  })
})

describe('strict validation', () => {
  it('rejects unknown layouts, bad specs and too few questions', () => {
    expect(validateHybridPage(normalizeHybridPage({ layout: 'crossword' }), opts())).toEqual(['layout missing or not one of the allowed layouts'])
    const dupe = normalizeHybridPage({ layout: 'matching', pairs: [{ term: 'a', match: 'x' }, { term: 'b', match: 'x' }, { term: 'c', match: 'y' }] })
    expect(validateHybridPage(dupe, opts())).toContain('pairs have duplicate matches')
    expect(validateHybridPage(normalizeHybridPage({ layout: 'questions', questions: [{ question: 'What is 2+2?', answer: '4' }] }), opts())[0]).toMatch(/only 1 questions/)
    expect(validateHybridPage(normalizeHybridPage({ layout: 'labeling', subject: 'a plant', labels: [{ word: 'root', clue: 'The root drinks water' }, { word: 'stem', clue: 'Holds it up' }, { word: 'leaf', clue: 'Makes food' }] }), opts())).toContain('labels[0].clue gives away its word')
  })

  it('flags picture-dependent text but keeps knowledge questions', () => {
    for (const t of ['Look at the picture. What is the bird doing?', 'How many apples do you see?', 'Colour the planet\'s rings yellow.', 'Circle the frog in the picture.', 'What does the illustration show?', 'Colour each leaf green.']) expect(isPictureDependent(t), t).toBe(true)
    for (const t of ['How many legs does a spider have?', 'Colour the picture.', 'Which planet has rings?', 'Sam has 5 red apples and 3 green apples. How many apples?']) expect(isPictureDependent(t), t).toBe(false)
    const n = normalizeHybridPage({ layout: 'questions', questions: ['What is in the picture?', 'What is 2+2?', 'What is 3+3?', 'What is 4+4?'].map((q, i) => ({ num: i + 1, question: q, answer: '1' })) })
    expect(validateHybridPage(n, opts()).join()).toMatch(/q1 depends on the picture/)
    const art = normalizeHybridPage({ layout: 'activity_art', subject: 'a planet', instruction: 'Colour the picture.', tasks: ['Colour the rings orange.'] })
    expect(validateHybridPage(art, opts()).join()).toMatch(/task 1 depends on the picture/)
  })

  it('flags questions that read content a questions page does not print, but not word problems', () => {
    expect(readsOtherPageContent('According to the story, who ran fastest?')).toBe(true)
    expect(readsOtherPageContent('In sentence 2, which word is a noun?')).toBe(true)
    expect(readsOtherPageContent('There are 5 apples in a basket. Sam adds 3. How many apples are there now?')).toBe(false)
  })

  it('open-ended questions and content too long for the page are rejected', () => {
    const open = normalizeHybridPage({ layout: 'questions', questions: ['Did you include a stem?', 'What is 2+2?', 'What is 3+3?', 'What is 4+4?'].map((q, i) => ({ num: i + 1, question: q, answer: '1' })) })
    expect(validateHybridPage(open, opts()).join()).toMatch(/open-ended/)
    const long = normalizeHybridPage({ layout: 'questions', questions: Array.from({ length: 12 }, (_, i) => ({ num: i + 1, question: 'Explain in detail why '.repeat(30), answer: 'because '.repeat(40) })) })
    expect(validateHybridPage(long, opts())).toContain('content too long for one page — use fewer or shorter items')
  })
})

describe('answer keys come from the spec', () => {
  it('matching content questions are the code-derived key; illustration subjects that print text are dropped', () => {
    const n = normalizeHybridPage(raw.matching)
    const c = hybridPageContent(raw.matching, n)
    expect(c).toMatchObject({ layout: 'matching', title: 'Plant Words', illustrationSubject: 'a sprouting bean seed' })
    expect(c.questions).toEqual(layoutAnswerKey('matching', n.spec))
    expect(hybridPageContent({ ...raw.matching, illustrationSubject: 'a colorful table with numbers' }, n).illustrationSubject).toBeUndefined()
  })

  it('ambiguous quadrilateral names accept every valid name', () => {
    expect(shapeItemQA({ kind: 'polygon', shape: 'square', ask: 'name' }).answer).toBe('square (also accept: rectangle, rhombus, quadrilateral)')
    expect(shapeItemQA({ kind: 'polygon', shape: 'hexagon', ask: 'name' }).answer).toBe('hexagon')
  })
})

describe('generateHybridPages: retry, chunking, fallbacks', () => {
  beforeEach(() => { resetReviewNotes(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  const pages = [page(2, 'plant-words-match', 'Match plant words'), page(3, 'plant-quiz', 'A multiple choice quiz'), page(4, 'fill', 'Fill in the blank'), page(5, 'sort', 'Sort living things')]

  it('chunks pages, retries only the invalid page with its errors, and validates', async () => {
    const calls = []
    const fetchChunk = vi.fn(async (_p, group, feedback) => {
      calls.push({ nums: group.map(g => g.pageNum), feedback: new Map(feedback) })
      return group.map(g => {
        if (g.pageNum === 2) return raw.matching
        if (g.pageNum === 3) return raw.mc
        if (g.pageNum === 4) return raw.fill
        // p5: invalid first (one category), fixed on retry
        return calls.length === 1 || calls.length === 2
          ? { pageNum: 5, title: 'Sort', layout: 'sorting', categories: ['Living'], sortItems: [{ word: 'dog', category: 'Living' }] }
          : { pageNum: 5, title: 'Sort', layout: 'sorting', categories: ['Living', 'Nonliving'], sortItems: ['dog', 'cat', 'rock', 'cup'].map((w, i) => ({ word: w, category: i < 2 ? 'Living' : 'Nonliving' })) }
      })
    })
    const { pages: done, failed } = await generateHybridPages(plan, pages, { fetchChunk })
    expect(calls.map(c => c.nums)).toEqual([[2, 3, 4].slice(0, HYBRID_PAGES_PER_CALL), [5], [5]])
    expect(calls[2].feedback.get(5).join()).toMatch(/categories/)
    expect(failed).toEqual([])
    expect([...done.keys()].sort()).toEqual([2, 3, 4, 5])
    expect(done.get(5).content.questions[0]).toEqual({ num: 1, question: 'Living', answer: 'dog, cat' })
  })

  it('a failed call (400) retries its pages one per call', async () => {
    const seen = []
    const fetchChunk = async (_p, group) => { seen.push(group.map(g => g.pageNum)); return group.length > 1 ? null : group.map(g => ({ ...raw.matching, pageNum: g.pageNum })) }
    const { failed } = await generateHybridPages(plan, pages.slice(0, 3), { fetchChunk })
    expect(seen).toEqual([[2, 3, 4], [2], [3], [4]])
    expect(failed).toEqual([])
  })

  it('a layout that never validates falls back to plain questions from its Q&A, else to the legacy list', async () => {
    // Too many options on every question (invalid), answers written out in full.
    const badMc = { ...raw.mc, pageNum: 3, questions: raw.mc.questions.map(q => ({ ...q, options: ['a', 'b', 'c', 'd', 'e'], answer: q.num === 3 ? 'Rain' : q.num === 1 ? 'Sunlight' : q.answer })) }
    const fetchChunk = async (_p, group) => group.map(g => (g.pageNum === 3 ? badMc : { pageNum: g.pageNum, title: 'x', layout: 'labeling', subject: '', labels: [] }))
    const { pages: done, failed } = await generateHybridPages(plan, [pages[0], pages[1]], { fetchChunk })
    expect(failed.map(f => f.pageNum)).toEqual([2])
    expect(done.get(3)).toMatchObject({ fallback: 'questions', content: { layout: 'questions' } })
    expect(reviewNotes().some(n => n.kind === 'fallback' && /p3/.test(n.message))).toBe(true)
    expect(done.get(3).content.questions.map(q => q.answer)).toEqual(['Sunlight', 'root', 'Rain', 'Carbon dioxide'])
    expect(questionsFallback([normalizeHybridPage(raw.mc)], opts())?.questions[0]).toEqual({ num: 1, question: 'What do plants need to make food?', answer: 'Sunlight' })
  })

  it('generateHybridContent: structured pages rechecked, failed pages get legacy content', async () => {
    const fetchChunk = async (_p, group) => group.map(g => (g.pageNum === 2 ? raw.matching : null)).filter(Boolean)
    const check = vi.fn(async () => ({ pass: true, corrections: [] }))
    const legacy = vi.fn(async (_p, failedPages) => failedPages.map(p => ({ pageNum: p.pageNum, title: 'Legacy', imageSpec: '', questions: [{ num: 1, question: 'What is 1+1?', answer: '2' }] })))
    const out = await generateHybridContent(plan, pages.slice(0, 2), { fetchChunk, check, legacy })
    expect(out.get(2).layout).toBe('matching')
    expect(out.get(3)).toEqual({ title: 'Legacy', imageSpec: '', questions: [{ num: 1, question: 'What is 1+1?', answer: '2' }] })
    expect(check).toHaveBeenCalledOnce()
    expect(legacy.mock.calls[0][1].map(p => p.pageNum)).toEqual([3])
  })
})

describe('structured recheck', () => {
  beforeEach(() => { resetReviewNotes(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  const content = (r) => hybridPageContent(r, normalizeHybridPage(r))

  it('shows each layout as numbered items; shapes are not sent', () => {
    const items = recheckItems(content(raw.mc))
    expect(items[0]).toMatchObject({ num: 1, question: 'What do plants need to make food? Options: A) Sunlight B) Sand C) Plastic', answer: 'A) Sunlight' })
    expect(recheckItems(content({ layout: 'shapes', shapeItems: [{ kind: 'count', icon: 'star', count: 3 }] }))).toEqual([])
  })

  it('applies valid corrections: MC letter, matching swap keeps a bijection, answer key rebuilt', () => {
    const mc = applyHybridCorrections(3, content(raw.mc), [{ pageNum: 3, questionNum: 4, correctedAnswer: 'B', reason: 'x' }], opts())
    expect(mc.spec.questions[3].answer).toBe('B')
    expect(mc.questions[3].answer).toBe('B. Helium')
    const m = applyHybridCorrections(2, content(raw.matching), [{ pageNum: 2, questionNum: 3, correctedAnswer: 'Holds the plant up', reason: 'x' }], opts())
    expect(m.spec.pairs[2].match).toBe('Holds the plant up')
    expect(m.spec.pairs[3].match).toBe('Makes food for the plant using sunlight')
    expect(m.questions).toEqual(layoutAnswerKey('matching', m.spec))
    expect(reviewNotes().filter(n => n.kind === 'answer_corrected')).toHaveLength(2)
  })

  it('reverts corrections outside the page\'s choices and picture-dependent rewrites', () => {
    const fill = content(raw.fill)
    const same = applyHybridCorrections(4, fill, [{ pageNum: 4, questionNum: 1, correctedAnswer: 'bean', reason: 'x' }], opts())
    expect(same).toEqual(fill)
    const q = content({ layout: 'questions', title: 'Q', questions: ['What is 2+2?', 'What is 3+3?', 'What is 4+4?', 'What is 5+5?'].map((x, i) => ({ num: i + 1, question: x, answer: '1' })) })
    const r = applyHybridCorrections(5, q, [{ pageNum: 5, questionNum: 1, correctedQuestion: 'How many apples are in the picture?', correctedAnswer: '3', reason: 'x' }], opts())
    expect(r).toEqual(q)
    expect(reviewNotes().filter(n => n.kind === 'spec_mismatch')).toHaveLength(2)
  })
})

describe('routing + rendering hybrid content end to end (FLUX stubbed)', () => {
  const env = { PAGE_RENDERER: 'hybrid' }
  const withContent = (r, p) => ({ ...p, content: hybridPageContent(r, normalizeHybridPage(r)) })

  it('structured pages route to their own layout; invalid or chart specs go to the classifier / chart renderer', () => {
    const m = withContent(raw.matching, page(2, 'm', ''))
    expect(structuredRoute(m)).toMatchObject({ route: 'hybrid', layout: 'matching', spec: m.content.spec })
    expect(routePage(m, env).layout).toBe('matching')
    expect(routePage(m, {})).toEqual({ route: 'legacy' })
    expect(structuredRoute(withContent(raw.fill, page(4, 'f', '')))).toMatchObject({ layout: 'fill_blank', wordBank: ['seed', 'seedling', 'soil', 'sunlight'] })
    expect(structuredRoute({ ...m, content: { ...m.content, spec: { pairs: [] } } })).toBeNull()
    expect(structuredRoute({ ...m, content: { title: 'x', imageSpec: '', questions: [] } })).toBeNull()
  })

  it('renders a matching page with the content\'s illustration subject and an answer key from the spec', async () => {
    const m = withContent(raw.matching, page(2, 'plant-words', 'Match words'))
    expect(pageIllustrationSubject(plan, m)).toBe('a sprouting bean seed')
    const get = vi.fn(async () => stubIllustration())
    const legacy = vi.fn()
    const out = await generateWorksheetPage(plan, m, { env, illustrations: { get }, legacy })
    expect(legacy).not.toHaveBeenCalled()
    expect(out.buffer.subarray(1, 4).toString()).toBe('PNG')
    expect(get.mock.calls[0][0]).toContain('a sprouting bean seed')
    const keySvg = answerKeySvg({ ...plan, pages: [m] }, { pageNum: 9, type: 'answer_key', sourcePageNums: [2] })
    for (const q of m.content.questions) expect(keySvg).toContain(q.answer.replace(/&/g, '&amp;').slice(0, 20))
  })

  it('renders every other structured layout without error', async () => {
    const illustrations = { get: async () => stubIllustration() }
    const specs = [
      raw.mc, raw.fill,
      { layout: 'labeling', title: 'Plant Parts', subject: 'a sunflower', labels: [{ word: 'root', clue: 'Drinks water from the soil' }, { word: 'stem', clue: 'Holds the flower up' }, { word: 'petal', clue: 'Colourful part that attracts bees' }] },
      { layout: 'activity_art', title: 'Colour', subject: 'a sunflower', instruction: 'Colour the picture.' },
    ]
    for (const r of specs) {
      const p = withContent(r, page(6, 'x', ''))
      const { buffer } = await renderHybridPage(plan, p, { ...structuredRoute(p), illustrations })
      expect(buffer.length).toBeGreaterThan(1000)
    }
  })
})
