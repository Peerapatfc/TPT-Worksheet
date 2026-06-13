import { describe, it, expect } from 'vitest'
import { buildCaption } from '../src/steps/notify-telegram.js'

const plan = {
  setTitle: 'Fractions: Add & Subtract!',
  gradeLevel: 'Grade 3',
  subject: 'Math',
  pageCount: 22,
  tptListing: {
    keywords: ['fractions', 'no prep', 'grade 3 math', 'common core', 'printable', 'extra'],
    suggestedPrice: 4.5,
  },
}

describe('buildCaption (MarkdownV2)', () => {
  const caption = buildCaption(plan, 'https://drive.google.com/drive/folders/abc123')

  it('escapes special characters in the bold title', () => {
    // ':', '&', '!' -> only '!' is special in V2; ':' and '&' are literal
    expect(caption).toContain('✅ *Fractions: Add & Subtract\\!*')
  })

  it('escapes the literal pipe between grade and subject', () => {
    expect(caption).toContain('📚 Grade 3 \\| Math')
  })

  it('escapes the dot in the price', () => {
    expect(caption).toContain('💰 Suggested: $4\\.50')
  })

  it('limits keywords to the first five', () => {
    expect(caption).toContain('🔑 fractions, no prep, grade 3 math, common core, printable')
    expect(caption).not.toContain('extra')
  })

  it('keeps the Drive link intact', () => {
    expect(caption).toContain('📁 [Open in Drive](https://drive.google.com/drive/folders/abc123)')
  })

  it('does not leave any unescaped bare period in the dynamic price line', () => {
    const priceLine = caption.split('\n').find(l => l.startsWith('💰'))
    expect(priceLine).not.toMatch(/[^\\]\.\d/)
  })
})
