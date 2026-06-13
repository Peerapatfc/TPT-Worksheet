import { describe, it, expect } from 'vitest'
import { slugify } from '../src/lib/slugify.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Fractions Grade 3')).toBe('fractions-grade-3')
  })

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(slugify('A & B  --  C!!!D')).toBe('a-b-c-d')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  !Hello World!  ')).toBe('hello-world')
  })

  it('respects an optional max length', () => {
    const long = 'a'.repeat(80)
    expect(slugify(long, 50)).toHaveLength(50)
  })

  it('does not truncate when no max length is given', () => {
    const long = 'a'.repeat(80)
    expect(slugify(long)).toHaveLength(80)
  })

  it('handles all-symbol input', () => {
    expect(slugify('@#$%')).toBe('')
  })
})
