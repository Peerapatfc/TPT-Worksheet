import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { samples } from './fixtures/layout-samples.js'
import { stubIllustration } from './helpers/stub-art.js'
import { rng, assertLayout } from './helpers/layout.js'
import { diffGolden } from './helpers/golden.js'
import { validateLayoutSpec, layoutAnswerKey, seededOrder, matchingOrder, shapeItemQA, LETTERS, LAYOUTS } from '../src/lib/layout/specs.js'
import { renderLayout, LAYOUT_REGISTRY } from '../src/lib/layout/index.js'
import { LayoutOverflowError, NBSP } from '../src/lib/layout/measure.js'
import { partGrid } from '../src/lib/layout/shapes.js'
import { renderSvg } from '../src/lib/svg-templates.js'
import { renderHybridPage } from '../src/lib/hybrid-page.js'
import { buildPageIllustrationPrompt, buildColoringPrompt } from '../src/lib/illustrations.js'
import { resetReviewNotes } from '../src/lib/review-notes.js'

const svgText = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join(' ').replace(new RegExp(NBSP, 'g'), ' ')
const sample = (name) => structuredClone(samples.find(s => s.name === name))
const ART = { ill: { href: 'data:image/png;base64,AAAA', width: 600, height: 450 } }

describe('layout specs', () => {
  it('every sample spec is valid and every registered layout has a validator', () => {
    for (const s of samples) expect(validateLayoutSpec(s.layout, s.spec), s.name).toEqual([])
    for (const l of LAYOUTS) if (!['questions', 'fill_blank'].includes(l)) expect(LAYOUT_REGISTRY[l], l).toBeDefined()
    expect(validateLayoutSpec('nope', {})).toEqual(['unknown layout nope'])
  })

  it('rejects specs whose answers the page could not support', () => {
    const mc = sample('multiple-choice').spec
    mc.questions[0].answer = 'Pluto'
    expect(validateLayoutSpec('multiple_choice', mc).join()).toMatch(/not exactly one of its options/)
    mc.questions[0] = { ...mc.questions[0], options: ['Mars', 'mars'], answer: 'A' }
    expect(validateLayoutSpec('multiple_choice', mc).join()).toMatch(/duplicate options/)

    const m = sample('matching').spec
    m.pairs[1].match = m.pairs[0].match
    expect(validateLayoutSpec('matching', m).join()).toMatch(/duplicate matches/)

    const so = sample('sorting').spec
    so.items[0].category = '-ug family'
    expect(validateLayoutSpec('sorting', so).join()).toMatch(/not one of the categories/)

    const la = sample('labeling').spec
    la.labels[0].clue = 'The roots drink water.'
    expect(validateLayoutSpec('labeling', la).join()).toMatch(/gives away/)

    const t = sample('table-fill').spec
    t.rows = t.rows.map(r => r.map(c => (typeof c === 'object' ? '1' : c)))
    expect(validateLayoutSpec('table_fill', t).join()).toMatch(/no blank cell/)
    expect(validateLayoutSpec('table_fill', { ...sample('table-fill').spec, rows: [['a'], ['b']] }).join()).toMatch(/must have 4 cells/)

    const sh = { items: [{ kind: 'fraction', shape: 'circle', parts: 4, shaded: 5, ask: 'name' }, { kind: 'polygon', shape: 'circle', ask: 'sides' }, { kind: 'count', icon: 'apple', count: 3 }] }
    const errs = validateLayoutSpec('shapes', sh).join(' | ')
    expect(errs).toMatch(/shaded/)
    expect(errs).toMatch(/circle can only ask for its name/)
    expect(errs).toMatch(/icon must be/)
  })
})

describe('deterministic shuffles + answer keys', () => {
  it('seededOrder is a stable permutation, and a derangement when asked', () => {
    expect(seededOrder(6, 'k')).toEqual(seededOrder(6, 'k'))
    for (let n = 2; n <= 10; n++) {
      for (const key of ['a', 'b', 'leaves', 'cvc']) {
        const p = seededOrder(n, key, { derange: true })
        expect([...p].sort((a, b) => a - b)).toEqual([...Array(n).keys()])
        expect(p.every((v, i) => v !== i)).toBe(true)
      }
    }
  })

  it('matching key letters point at the row that prints the right meaning', () => {
    const { plan, page, spec } = sample('matching')
    const out = renderLayout('matching', plan, page, spec)
    const text = svgText(out.svg)
    const order = matchingOrder(spec)
    const key = layoutAnswerKey('matching', spec)
    key.forEach((k, i) => {
      const letter = k.answer[0]
      const row = LETTERS.indexOf(letter)
      expect(order[row]).toBe(i) // right row `row` shows pair i's meaning
    })
    // Right column is printed in shuffled order, never in answer order.
    const firstWords = order.map(i => spec.pairs[i].match.split(' ').slice(0, 2).join(' '))
    const positions = firstWords.map(w => text.indexOf(w))
    expect(positions.every((p, i) => i === 0 || p > positions[i - 1])).toBe(true)
    expect(order.some((v, i) => v !== i)).toBe(true)
  })

  it('derives every key from the spec (letters, categories, blanks, shape answers)', () => {
    expect(layoutAnswerKey('multiple_choice', sample('multiple-choice').spec).map(q => q.answer)).toEqual(['B. Mercury', 'A. Saturn', 'C. A year', 'B. Carbon dioxide', 'B. reflects light from the Sun'])
    expect(layoutAnswerKey('sorting', sample('sorting').spec)[1]).toEqual({ num: 2, question: '-og family', answer: 'dog, log, frog' })
    expect(layoutAnswerKey('labeling', sample('labeling').spec)[0].answer).toBe('roots')
    const t = layoutAnswerKey('table_fill', sample('table-fill').spec)
    expect(t.map(q => q.answer)).toEqual(['12', '10', '3', '4', 'Maple', '2 cm'])
    expect(t[0].question).toBe('Length + Width — row 1 (Maple)')
    expect(layoutAnswerKey('shapes', sample('shapes').spec).map(q => q.answer)).toEqual(['3/4', '2/6', '2 of 5 parts shaded', '13', '6', 'triangle'])
    expect(layoutAnswerKey('activity_art', sample('activity-art').spec)).toEqual([])
  })

  it('shape questions and answers come from the numbers', () => {
    expect(shapeItemQA({ kind: 'count', icon: 'heart', count: 7 })).toEqual({ question: 'How many hearts?', answer: '7' })
    expect(shapeItemQA({ kind: 'polygon', shape: 'octagon', ask: 'corners' })).toEqual({ question: 'How many corners?', answer: '8' })
    expect(partGrid(6)).toEqual([2, 3])
    expect(partGrid(7)).toEqual([1, 7])
    expect(partGrid(4)).toEqual([2, 2])
  })
})

describe('layout rendering', () => {
  it('every sample fits without overlap and prints its text exactly once escaped', () => {
    for (const s of samples) {
      const out = renderLayout(s.layout, s.plan, s.page, s.spec, { art: LAYOUT_REGISTRY[s.layout].art === 'none' ? null : ART })
      assertLayout(out)
      const text = svgText(out.svg)
      if (s.layout === 'multiple_choice') for (const q of s.spec.questions) for (const o of q.options) expect(text).toContain(o.split(' ')[0])
      if (s.layout === 'sorting') for (const it of s.spec.items) expect(text).toContain(it.word)
      if (s.layout === 'labeling') for (const l of s.spec.labels) expect(text).toContain(l.word)
    }
  })

  it('never prints answers on the student page', () => {
    const t = renderLayout('table_fill', ...['table-fill'].map(n => sample(n)).flatMap(s => [s.plan, s.page, s.spec]))
    expect(svgText(t.svg)).not.toMatch(/\b12\b/)
    const sh = sample('shapes')
    const text = svgText(renderLayout('shapes', sh.plan, sh.page, sh.spec).svg)
    expect(text).not.toContain('3/4')
    expect(text).not.toContain('13')
  })

  it('shapes are drawn by code: right number of parts, shaded parts and icons', () => {
    const sh = sample('shapes')
    sh.spec.items = [{ kind: 'fraction', shape: 'circle', parts: 8, shaded: 3, ask: 'name' }, { kind: 'count', icon: 'star', count: 11 }]
    const svg = renderLayout('shapes', sh.plan, sh.page, sh.spec).svg
    const figs = svg.split('class="shape-figure"').slice(1).map(f => f.split('</g>')[0])
    expect((figs[0].match(/<path /g) ?? []).length).toBe(8)
    expect((figs[0].match(/fill="#C2410C"/g) ?? []).length).toBe(3)
    expect((figs[1].match(/class="chart-icon"/g) ?? []).length).toBe(11)
  })

  it('labeling keeps the leader lines out of the picture and falls back to a picture-less page', () => {
    const { plan, page, spec } = sample('labeling')
    const out = renderLayout('labeling', plan, page, spec, { art: ART })
    expect(out.meta.art).toBe('side')
    const art = out.boxes.find(b => b.kind === 'art')
    for (const m of out.svg.matchAll(/<path d="M([\d.]+) [\d.]+ L([\d.]+) [\d.]+" stroke="[^"]+" stroke-width="3" stroke-dasharray="2 7"/g)) {
      expect(Number(m[2])).toBeGreaterThanOrEqual(art.x + art.w)
    }
    const none = renderLayout('labeling', plan, page, spec, { art: null })
    expect(none.boxes.some(b => b.kind === 'art')).toBe(false)
    assertLayout(none)
  })
})

// Random specs per layout: every result either fits without overlap or throws
// LayoutOverflowError (→ the router falls back) — never overflows silently.
const WORDS = ['leaf', 'planet', 'Saturn', 'photosynthesis', 'the', 'a', 'red', '&', '<b>', 'naïve', '"quoted"', "it's", 'x'.repeat(28), 'W'.repeat(12), '12', '🍎', 'ภาษา']
const phrase = (r, n) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ')
const uniq = (list) => list.map((w, i) => `${w}${i}`)
const GEN = {
  multiple_choice: (r) => ({ questions: Array.from({ length: 1 + Math.floor(r() * 12) }, (_, k) => {
    const options = uniq(Array.from({ length: 2 + Math.floor(r() * 3) }, () => phrase(r, 1 + Math.floor(r() * 6)).slice(0, 150)))
    return { num: k + 1, question: phrase(r, 2 + Math.floor(r() * 25)), options, answer: 'A' }
  }) }),
  matching: (r) => ({ pairs: Array.from({ length: 3 + Math.floor(r() * 8) }, (_, k) => ({ term: `${phrase(r, 1 + Math.floor(r() * 3)).slice(0, 36)}${k}`, match: `${phrase(r, 2 + Math.floor(r() * 18)).slice(0, 150)}${k}` })) }),
  sorting: (r) => {
    const categories = uniq(Array.from({ length: 2 + Math.floor(r() * 3) }, () => phrase(r, 1 + Math.floor(r() * 4)).slice(0, 36)))
    return { categories, items: Array.from({ length: 4 + Math.floor(r() * 13) }, (_, k) => ({ word: `${phrase(r, 1).slice(0, 26)}${k}`, category: categories[k % categories.length] })) }
  },
  labeling: (r) => ({ subject: 'a plant', labels: Array.from({ length: 3 + Math.floor(r() * 6) }, (_, k) => ({ word: `w${k}`, clue: `${phrase(r, 3 + Math.floor(r() * 22)).slice(0, 150)}` })) }),
  table_fill: (r) => {
    const n = 2 + Math.floor(r() * 4)
    return {
      columns: Array.from({ length: n }, () => phrase(r, 1 + Math.floor(r() * 3)).slice(0, 36)),
      rows: Array.from({ length: 2 + Math.floor(r() * 9) }, (_, i) => Array.from({ length: n }, (_, j) => ((i + j) % 3 === 1 ? { answer: String(i * j) } : phrase(r, 1 + Math.floor(r() * 3)).slice(0, 36)))),
      questions: Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({ num: k + 1, question: phrase(r, 3 + Math.floor(r() * 15)), answer: phrase(r, 1 + Math.floor(r() * 8)) })),
    }
  },
  shapes: (r) => ({ items: Array.from({ length: 1 + Math.floor(r() * 9) }, () => {
    const k = Math.floor(r() * 3)
    if (k === 0) { const parts = 2 + Math.floor(r() * 11); return { kind: 'fraction', shape: ['circle', 'rectangle', 'bar'][Math.floor(r() * 3)], parts, shaded: 1 + Math.floor(r() * parts), ask: r() > 0.5 ? 'name' : 'shade' } }
    if (k === 1) return { kind: 'count', icon: ['star', 'heart', 'circle', 'square', 'triangle'][Math.floor(r() * 5)], count: 1 + Math.floor(r() * 20) }
    return { kind: 'polygon', shape: ['triangle', 'square', 'hexagon', 'octagon', 'trapezoid'][Math.floor(r() * 5)], ask: ['sides', 'corners', 'name'][Math.floor(r() * 3)] }
  }) }),
  activity_art: (r) => ({ subject: 'a cat', instruction: phrase(r, 3 + Math.floor(r() * 20)).slice(0, 150), tasks: Array.from({ length: Math.floor(r() * 4) }, () => phrase(r, 2 + Math.floor(r() * 18)).slice(0, 150)) }),
}

describe('layouts (property)', () => {
  const plan = { setTitle: 'Autumn & <Fall> "Science"', gradeLevel: 'Grade 3', themeColor: '#2E7D32', subject: 'Science' }
  for (const [layout, gen] of Object.entries(GEN)) {
    it(`${layout}: 60 random specs fit without overlap or throw LayoutOverflowError`, () => {
      const r = rng(layout.length * 97)
      let fitted = 0
      for (let i = 0; i < 60; i++) {
        const spec = gen(r)
        expect(validateLayoutSpec(layout, spec), JSON.stringify(spec).slice(0, 200)).toEqual([])
        const page = { pageNum: 3, type: 'worksheet', filename: 'p', content: { title: phrase(r, 1 + Math.floor(r() * 6)) } }
        let out
        try { out = renderLayout(layout, plan, page, spec, { art: [ART, true, null][i % 3] }) } catch (err) {
          expect(err).toBeInstanceOf(LayoutOverflowError)
          continue
        }
        fitted++
        assertLayout(out)
        expect(out.svg).not.toMatch(/<b>/)
      }
      expect(fitted).toBeGreaterThan(30)
    }, 30000)
  }

  it('falls back to two columns before shrinking below 20px', () => {
    const page = { pageNum: 2, type: 'worksheet', filename: 'p', content: { title: 'Quiz' } }
    const spec = { questions: Array.from({ length: 12 }, (_, k) => ({ num: k + 1, question: `Which word names thing ${k}?`, options: ['apple', 'pear', 'plum', 'fig'], answer: 'A' })) }
    const out = renderLayout('multiple_choice', plan, page, spec)
    assertLayout(out)
    expect(out.meta).toMatchObject({ columns: 2 })
    expect(out.meta.size).toBeGreaterThanOrEqual(20)
    expect(out.boxes.filter(b => b.kind === 'badge').some(b => b.x > 500)).toBe(true)
  })
})

describe('golden images (stub illustration, no network)', () => {
  // Perceptual check: 256px greyscale thumbnails must match the committed goldens
  // (UPDATE_GOLDENS=1 rewrites them after an intended change — view them first).
  for (const s of samples) {
    it(`${s.name} matches its golden`, async () => {
      const art = LAYOUT_REGISTRY[s.layout].art === 'none' ? null : { ill: await stubIllustration() }
      const out = renderLayout(s.layout, s.plan, s.page, s.spec, { art })
      const png = await renderSvg(out.svg)
      const meta = await sharp(png).metadata()
      expect([meta.width, meta.height]).toEqual([1024, 1536])
      const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
      const inked = data.reduce((n, v) => n + (v < 200 ? 1 : 0), 0) / data.length
      expect(inked).toBeGreaterThan(0.03) // not blank
      const d = await diffGolden(png, `layout-${s.name}`)
      expect(d.changed).toBeLessThan(0.01)
      expect(d.mean).toBeLessThan(3)
    }, 20000)
  }
})

describe('renderHybridPage per layout', () => {
  beforeEach(() => resetReviewNotes())

  it('asks FLUX for the right picture: spot, the labeling subject, colouring line art — none for shapes', async () => {
    const ill = await stubIllustration()
    for (const s of samples) {
      const illustrations = { get: vi.fn(async () => ill) }
      const { buffer, meta } = await renderHybridPage(s.plan, s.page, { layout: s.layout, spec: s.spec, illustrations })
      expect(buffer.length).toBeGreaterThan(1000)
      expect(meta.layout).toBe(s.layout)
      const kind = LAYOUT_REGISTRY[s.layout].art
      if (kind === 'none') expect(illustrations.get).not.toHaveBeenCalled()
      else expect(illustrations.get).toHaveBeenCalledOnce()
      if (kind === 'large') expect(illustrations.get).toHaveBeenCalledWith(buildPageIllustrationPrompt(s.spec.subject))
      if (kind === 'lineart') expect(illustrations.get).toHaveBeenCalledWith(buildColoringPrompt(s.spec.subject))
    }
  }, 30000)
})
