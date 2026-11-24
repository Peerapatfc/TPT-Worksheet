import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { measureText, wrapText, wrapTokens, fitText, fitLine, glueMath, cleanText, NBSP, LayoutOverflowError } from '../src/lib/layout/measure.js'
import { questionsPageSvg, fillBlankPageSvg, sentenceTokens, CONTENT, isShortAnswer, answerLineCount } from '../src/lib/layout/worksheet.js'
import { PAGE_W, PAGE_H } from '../src/lib/svg-templates.js'

// Deterministic PRNG so property failures are reproducible.
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}
const POOL = ['the', 'cat', 'sat', 'on', 'a', 'mat', '7', '+', '5', '=', '?', 'How', 'many', 'apples', 'are', 'left',
  'photosynthesis', 'Supercalifragilisticexpialidocious'.repeat(2), 'x'.repeat(60), '&', '<b>', '"quoted"', "it's",
  'Tom & Jerry', '🍎🍂', 'ภาษาไทย', 'naïve', 'café', '—', '12,345', '3/4', 'W'.repeat(25)]
const sentence = (r, n) => Array.from({ length: n }, () => POOL[Math.floor(r() * POOL.length)]).join(' ')

const plan = { setTitle: 'Autumn & <Fall> "Math" Adventures', gradeLevel: 'Grade 2', themeColor: '#E8731C', subject: 'Math' }
const STUB_ART = { ill: { href: 'data:image/png;base64,AAAA', width: 600, height: 450 } }

function overlaps(a, b) {
  const e = 0.5
  return a.x + e < b.x + b.w && b.x + e < a.x + a.w && a.y + e < b.y + b.h && b.y + e < a.y + a.h
}

/** Every drawn box stays on the page / in the content column, and no two overlap. */
function assertLayout({ boxes }) {
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(PAGE_W)
    expect(b.y + b.h).toBeLessThanOrEqual(PAGE_H)
    if (['text', 'badge', 'answer', 'blank', 'bank', 'art'].includes(b.kind)) {
      expect(b.x).toBeGreaterThanOrEqual(CONTENT.left - 0.5)
      expect(b.x + b.w).toBeLessThanOrEqual(CONTENT.right + 0.5)
      expect(b.y + b.h).toBeLessThanOrEqual(CONTENT.bottom + 0.5)
    }
  }
  const solid = boxes.filter(b => b.kind !== 'bg')
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i], solid[j])) throw new Error(`overlap: ${JSON.stringify(solid[i])} × ${JSON.stringify(solid[j])}`)
    }
  }
  // Background panels never overlap each other or the illustration.
  const panels = boxes.filter(b => b.kind === 'bg' || b.kind === 'art' || b.kind === 'bank')
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) expect(overlaps(panels[i], panels[j])).toBe(false)
}

const svgText = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join(' ').replace(new RegExp(NBSP, 'g'), ' ')
const esc = (w) => w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

describe('measure', () => {
  it('measures wider for longer and bold text, and ≥ 1 em for unknown scripts', () => {
    expect(measureText('abc', 20)).toBeGreaterThan(measureText('ab', 20))
    expect(measureText('abc', 20, { bold: true })).toBeGreaterThan(measureText('abc', 20))
    expect(measureText('ก', 20)).toBeGreaterThanOrEqual(20)
    expect(measureText('🍎', 20)).toBeGreaterThanOrEqual(20)
  })

  it('wraps every line within the width, hard-splitting giant words, and loses no characters', () => {
    const r = rng(1)
    for (let i = 0; i < 200; i++) {
      const s = sentence(r, 1 + Math.floor(r() * 40))
      const width = 120 + r() * 700
      const size = 14 + r() * 24
      const bold = r() > 0.5
      const lines = wrapText(s, width, size, { bold })
      for (const l of lines) expect(measureText(l, size, { bold })).toBeLessThanOrEqual(width + 1e-6)
      expect(lines.join('').replace(/[\s ]/g, '')).toBe(cleanText(s).replace(/\s/g, ''))
    }
  })

  it('keeps a math expression on one line when it fits', () => {
    expect(glueMath(['Add:', '7', '+', '5', '=', '?'])).toEqual([`Add:`, `7${NBSP}+${NBSP}5${NBSP}=${NBSP}?`])
    const lines = wrapText('Add the two numbers: 7 + 5 = ?', 260, 30, { bold: true })
    expect(lines.some(l => l.includes(`7${NBSP}+${NBSP}5`))).toBe(true)
  })

  it('places inline blanks without exceeding the line width', () => {
    const lines = wrapTokens(sentenceTokens('The ___ sat on the ___ near the big ___ today.', 150), 400, 28)
    for (const line of lines) for (const t of line) expect(t.x + t.w).toBeLessThanOrEqual(400 + 1e-6)
    expect(lines.flat().filter(t => t.blank)).toHaveLength(3)
    expect(sentenceTokens('No blank here (blank 2).', 100).at(-1)).toEqual({ blank: 100 })
  })

  it('fitText shrinks then throws; fitLine truncates header text only', () => {
    expect(fitText('short', { width: 500, maxLines: 1, max: 30, min: 16 }).size).toBe(30)
    expect(() => fitText('word '.repeat(200), { width: 200, maxLines: 2, max: 30, min: 16 })).toThrow(LayoutOverflowError)
    const f = fitLine('x'.repeat(300), { width: 300, max: 30, min: 16 })
    expect(f.text.endsWith('…')).toBe(true)
    expect(measureText(f.text, f.size)).toBeLessThanOrEqual(300)
  })

  it('strips XML-invalid control characters', () => {
    expect(cleanText('a\u0000b\u0007c\nd')).toBe('abc d')
  })
})

describe('answer space', () => {
  it('short answers get a box, longer ones 1–3 lines', () => {
    expect(isShortAnswer('12')).toBe(true)
    expect(isShortAnswer('Carbon dioxide')).toBe(true)
    expect(isShortAnswer('Saturn rings are ice')).toBe(false)
    expect(answerLineCount('x'.repeat(20))).toBe(1)
    expect(answerLineCount('x'.repeat(80))).toBe(2)
    expect(answerLineCount('x'.repeat(200))).toBe(3)
  })
})

describe('questions layout (property)', () => {
  it('never overflows or overlaps across 200 random pages; prints every word, escaped', () => {
    const r = rng(42)
    let fitted = 0
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(r() * 12)
      const page = {
        pageNum: 2, type: r() > 0.5 ? 'worksheet' : 'activity', filename: 'p',
        content: { title: sentence(r, 1 + Math.floor(r() * 12)), questions: Array.from({ length: n }, (_, k) => ({
          num: k + 1, question: sentence(r, 2 + Math.floor(r() * 30)), answer: r() > 0.5 ? String(k) : sentence(r, 1 + Math.floor(r() * 25)),
        })) },
      }
      const art = [STUB_ART, true, null][i % 3]
      let out
      try { out = questionsPageSvg(plan, page, { art }) } catch (err) {
        expect(err).toBeInstanceOf(LayoutOverflowError)
        continue
      }
      fitted++
      assertLayout(out)
      const printed = svgText(out.svg).replace(/\s/g, '')
      for (const q of page.content.questions) expect(printed).toContain(esc(cleanText(q.question).replace(/\s/g, '')))
      expect(out.svg).not.toMatch(/<b>/)
    }
    // The rest are pages of up to 12 × 30 random words incl. 60-char words: they
    // must throw LayoutOverflowError (→ caller falls back), never overflow.
    expect(fitted).toBeGreaterThan(120)
  })

  it('fits 12 long questions by shrinking and dropping the illustration before failing', () => {
    const page = { pageNum: 3, type: 'worksheet', content: { title: 'Many', questions: Array.from({ length: 12 }, (_, k) => ({
      num: k + 1, question: 'Sam has some apples in a basket and gives a few away to his friends at school. How many are left?', answer: 'Some apples are left over',
    })) } }
    const out = questionsPageSvg(plan, page, { art: STUB_ART })
    assertLayout(out)
    expect(out.meta.size).toBeLessThan(26)
  })

  it('puts the illustration in its own slot, inside the content column', () => {
    const page = { pageNum: 2, type: 'worksheet', content: { title: 'Addition', questions: [
      { num: 1, question: 'Add: 7 + 5 = ?', answer: '12' }, { num: 2, question: 'Subtract: 14 - 6 = ?', answer: '8' },
    ] } }
    const out = questionsPageSvg(plan, page, { art: STUB_ART })
    expect(out.meta.art).toBe('band')
    expect(out.boxes.filter(b => b.kind === 'art')).toHaveLength(1)
    expect(out.svg).toContain('<image')
    assertLayout(out)
    const fallback = questionsPageSvg(plan, page, { art: true })
    expect(fallback.svg).not.toContain('<image')
    expect(fallback.boxes.filter(b => b.kind === 'art')).toHaveLength(1)
  })

  it('uses the top-right float when the band does not fit', () => {
    const page = { pageNum: 2, type: 'worksheet', content: { title: 'Facts', questions: Array.from({ length: 8 }, (_, k) => ({
      num: k + 1, question: `What is ${k} × 7?`, answer: String(k * 7),
    })) } }
    const out = questionsPageSvg(plan, page, { art: STUB_ART })
    assertLayout(out)
    expect(['band', 'float']).toContain(out.meta.art)
  })

  it('renders XML-special characters, emoji and Thai to a valid PNG', async () => {
    const page = { pageNum: 2, type: 'worksheet', content: { title: '<Title> & "more"', questions: [
      { num: 1, question: 'Is 3 < 5 && 5 > 3? Say "yes" or \'no\' 🍎 ภาษาไทย', answer: 'yes' },
    ] } }
    const out = questionsPageSvg(plan, page, { art: true })
    expect(out.svg.replace(new RegExp(NBSP, 'g'), ' ')).toContain('3 &lt; 5 &amp;&amp; 5 &gt; 3?')
    const meta = await sharp(Buffer.from(out.svg)).png().toBuffer().then(b => sharp(b).metadata())
    expect([meta.width, meta.height]).toEqual([PAGE_W, PAGE_H])
  })
})

describe('fill_blank layout (property)', () => {
  it('never overflows or overlaps across 200 random pages', () => {
    const r = rng(7)
    let fitted = 0
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(r() * 10)
      const bank = Array.from({ length: 1 + Math.floor(r() * 10) }, () => POOL[Math.floor(r() * POOL.length)].slice(0, 30))
      const page = { pageNum: 4, type: 'worksheet', content: { title: 'Fill', questions: Array.from({ length: n }, (_, k) => ({
        num: k + 1, question: `${sentence(r, 1 + Math.floor(r() * 14))} ___ ${sentence(r, Math.floor(r() * 10))}`, answer: 'x',
      })) } }
      let out
      try { out = fillBlankPageSvg(plan, page, { art: [STUB_ART, true, null][i % 3], wordBank: bank }) } catch (err) {
        expect(err).toBeInstanceOf(LayoutOverflowError)
        continue
      }
      fitted++
      assertLayout(out)
      expect(out.boxes.filter(b => b.kind === 'blank').length).toBeGreaterThanOrEqual(n)
    }
    expect(fitted).toBeGreaterThan(150)
  })

  it('prints the word bank and keeps the float below it', () => {
    const page = { pageNum: 4, type: 'worksheet', content: { title: 'CVC', questions: [
      { num: 1, question: 'The ___ sat on the mat.', answer: 'cat' }, { num: 2, question: 'The ___ barked.', answer: 'dog' },
    ] } }
    const out = fillBlankPageSvg(plan, page, { art: STUB_ART, wordBank: ['cat', 'dog'] })
    assertLayout(out)
    expect(out.svg).toContain('Word Bank')
    const bank = out.boxes.find(b => b.kind === 'bank')
    const art = out.boxes.find(b => b.kind === 'art')
    expect(art.y).toBeGreaterThanOrEqual(bank.y + bank.h)
  })
})
