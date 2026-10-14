import { describe, it, expect, beforeEach } from 'vitest'
import { addReviewNote, reviewNotes, resetReviewNotes, buildReviewMessage } from '../src/lib/review-notes.js'

describe('review notes', () => {
  beforeEach(() => resetReviewNotes())

  it('collects notes in order', () => {
    addReviewNote('qa_failed', 'p11: missing')
    addReviewNote('answer_leak', 'p3')
    expect(reviewNotes()).toEqual([{ kind: 'qa_failed', message: 'p11: missing' }, { kind: 'answer_leak', message: 'p3' }])
  })

  it('builds grouped sections, most urgent first, with cost', () => {
    const text = buildReviewMessage('Spiders', [
      { kind: 'answer_corrected', message: 'p2 q1: 3 → 4' },
      { kind: 'qa_failed', message: 'p11: q2 missing' },
      { kind: 'question_rewritten', message: 'p10 q5: "NOT" → "does"' },
    ], 0.358)
    expect(text.split('\n')[0]).toBe('🔍 Review: Spiders')
    expect(text).toContain('💵 API cost: $0.36')
    expect(text.indexOf('failed QA')).toBeLessThan(text.indexOf('rewritten'))
    expect(text.indexOf('rewritten')).toBeLessThan(text.indexOf('Answers corrected'))
    expect(text).toContain('• p11: q2 missing')
  })

  it('says nothing was flagged when the list is empty', () => {
    expect(buildReviewMessage('X', [], 0.3)).toContain('Nothing flagged')
  })

  it('truncates to the Telegram limit', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ kind: 'answer_corrected', message: `p${i} a long correction message` }))
    const text = buildReviewMessage('X', many, 1, 4000)
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text.endsWith('… (truncated)')).toBe(true)
  })
})
