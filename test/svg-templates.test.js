import { describe, it, expect } from 'vitest'
import { answerKeySvg, whatsIncludedSvg, benefitsSvg, fitFontSize, wrapText, escapeXml, safeColor } from '../src/lib/svg-templates.js'

const plan = {
  setTitle: 'Fractions & Fun',
  gradeLevel: 'Grade 3',
  pageCount: 6,
  themeColor: '#1B4F8A',
  pages: [
    { pageNum: 2, type: 'worksheet', content: { questions: [{ num: 1, question: 'What is 1/2 + 1/2?', answer: '1' }] } },
    { pageNum: 3, type: 'worksheet', content: { questions: [{ num: 1, question: 'Is 3 < 5?', answer: 'Yes' }] } },
  ],
}

describe('answerKeySvg', () => {
  it('lists each source page with its answers, header label, and theme color', () => {
    const svg = answerKeySvg(plan, { pageNum: 4, type: 'answer_key', sourcePageNums: [2, 3] })
    expect(svg).toContain('Answer Key (Pages 2 &amp; 3)')
    expect(svg).toContain('#1B4F8A')
    expect(svg).toContain('>Page 2<')
    expect(svg).toContain('>Page 3<')
    expect(svg).toContain('What is 1/2 + 1/2?')
    expect(svg).toContain('Is 3 &lt; 5?')
    expect(svg).toContain('>Yes<')
  })

  it('falls back to every question when no source pages resolve', () => {
    const svg = answerKeySvg(plan, { pageNum: 4, type: 'answer_key' })
    expect(svg).toContain('What is 1/2 + 1/2?')
    expect(svg).toContain('Is 3 &lt; 5?')
  })

  it('escapes the set title', () => {
    expect(answerKeySvg(plan, { pageNum: 4, type: 'answer_key' })).toContain('Fractions &amp; Fun')
  })
})

describe('marketing slide templates', () => {
  it('whatsIncluded shows counts and pluralizes answer keys', () => {
    const svg = whatsIncludedSvg({ color: '#2E7D32', worksheetCount: 10, answerKeyCount: 1, pageCount: 16, totalQuestions: 80 })
    expect(svg).toContain('10 No-Prep Worksheet &amp; Activity Pages')
    expect(svg).toContain('1 Answer Key Page<')
    expect(svg).toContain('80+ Practice Questions')
  })

  it('benefits omits the badge when empty', () => {
    expect(benefitsSvg({ color: '#2E7D32', badge: 'CCSS Aligned' })).toContain('CCSS Aligned')
    expect(benefitsSvg({ color: '#2E7D32', badge: '' })).not.toContain('Aligned')
  })
})

describe('helpers', () => {
  it('wrapText keeps lines within the char budget and hard-splits long words', () => {
    const lines = wrapText('a'.repeat(30) + ' bb cc', 100, 10)
    expect(lines.every(l => l.length <= 17)).toBe(true)
    expect(lines.join('')).toContain('bb')
  })

  it('escapeXml and safeColor', () => {
    expect(escapeXml(`<a & "b">`)).toBe('&lt;a &amp; &quot;b&quot;&gt;')
    expect(safeColor('red')).toBe('#1B4F8A')
    expect(safeColor('#abcdef')).toBe('#abcdef')
  })
})

describe('fitFontSize', () => {
  it('keeps the base size when every line fits', () => {
    expect(fitFontSize(['18 Total Pages'], 774, 38)).toBe(38)
  })

  it('shrinks until the longest line fits, never below the minimum', () => {
    const long = '11 No-Prep Worksheet & Activity Pages'
    const size = fitFontSize([long, '6 Answer Key Pages'], 774, 38)
    expect(size).toBeLessThan(38)
    expect(long.length * size * 0.66).toBeLessThanOrEqual(774)
    expect(fitFontSize(['x'.repeat(200)], 774, 38, 24)).toBe(24)
  })

  it('whatsIncludedSvg uses the fitted size so the long first row does not overflow', () => {
    const svg = whatsIncludedSvg({ color: '#4B5320', worksheetCount: 11, answerKeyCount: 6, pageCount: 18, totalQuestions: 55 })
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map(m => Number(m[1]))
    expect(sizes).not.toContain(38)
  })
})
