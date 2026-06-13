import { describe, it, expect } from 'vitest'
import { escapeMarkdownV2 } from '../src/lib/markdown.js'

describe('escapeMarkdownV2', () => {
  it('escapes every MarkdownV2 special character', () => {
    expect(escapeMarkdownV2('_*[]()~`>#+-=|{}.!')).toBe(
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!'
    )
  })

  it('escapes a backslash', () => {
    expect(escapeMarkdownV2('a\\b')).toBe('a\\\\b')
  })

  it('leaves plain text untouched', () => {
    expect(escapeMarkdownV2('Grade 3 Math')).toBe('Grade 3 Math')
  })

  it('escapes the dot in a decimal price', () => {
    expect(escapeMarkdownV2('2.00')).toBe('2\\.00')
  })

  it('coerces non-strings', () => {
    expect(escapeMarkdownV2(22)).toBe('22')
  })
})
