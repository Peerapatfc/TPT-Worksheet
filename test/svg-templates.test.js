import { describe, it, expect } from 'vitest'
import { answerKeySvg, whatsIncludedSvg, benefitsSvg, wrapText, escapeXml, safeColor } from '../src/lib/svg-templates.js'

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
