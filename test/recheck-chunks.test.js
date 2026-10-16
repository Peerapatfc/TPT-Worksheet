import { describe, it, expect } from 'vitest'
import { chunk, mergeValidations, isEmptyAnswerIssue } from '../src/steps/generate-content.js'

describe('chunk', () => {
  it('splits into groups of at most size, preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })
  it('returns [] for an empty list', () => {
    expect(chunk([], 5)).toEqual([])
  })
})

describe('mergeValidations', () => {
  it('concatenates corrections and spec fixes, skipping failed (null) chunks', () => {
    const merged = mergeValidations([
      { pass: true, corrections: [{ pageNum: 2 }], imageSpecCorrections: [{ pageNum: 2 }] },
      null,
      { pass: false, corrections: [{ pageNum: 8 }] },
    ])
    expect(merged.corrections).toEqual([{ pageNum: 2 }, { pageNum: 8 }])
    expect(merged.imageSpecCorrections).toEqual([{ pageNum: 2 }])
    expect(merged.pass).toBe(false)
  })
})

describe('isEmptyAnswerIssue', () => {
  it('matches only blank-answer issues', () => {
    expect(isEmptyAnswerIssue('page 6 q1 empty answer')).toBe(true)
    expect(isEmptyAnswerIssue('page 6 q1 empty question')).toBe(false)
    expect(isEmptyAnswerIssue('page 3 missing')).toBe(false)
  })
})
