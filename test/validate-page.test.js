import { describe, it, expect } from 'vitest'
import { judgeReport, buildValidationPrompt } from '../src/steps/validate-page.js'

const worksheet = { pageNum: 12, type: 'worksheet', content: { questions: [{ num: 1, question: 'Q1' }, { num: 2, question: 'Q2' }] } }
const clean = { questions: [], garbledText: false, noAnswerSpace: false, headerMissing: false, hasQuestionsOnCover: false }

describe('judgeReport', () => {
  it('passes when every listed question matches or only wording differs', () => {
    const r = judgeReport({ ...clean, questions: [{ num: 1, status: 'match' }, { num: 2, status: 'wording_differs' }], minorNotes: ['colors are bright'] }, worksheet)
    expect(r.pass).toBe(true)
    expect(r.issues).toEqual(['[minor] colors are bright'])
  })

  it('fails on a changed number or a missing question', () => {
    const r = judgeReport({ ...clean, questions: [{ num: 1, status: 'number_differs', note: '14 vs 18' }, { num: 2, status: 'missing' }] }, worksheet)
    expect(r.pass).toBe(false)
    expect(r.issues).toEqual(['[critical] q1 number_differs: 14 vs 18', '[critical] q2 missing'])
  })

  it('ignores statuses for question numbers that were not listed', () => {
    expect(judgeReport({ ...clean, questions: [{ num: 9, status: 'missing' }] }, worksheet).pass).toBe(true)
  })

  it('fails on page-level defects', () => {
    expect(judgeReport({ ...clean, garbledText: true }, worksheet).pass).toBe(false)
    expect(judgeReport({ ...clean, headerMissing: true }, worksheet).pass).toBe(false)
    expect(judgeReport({ ...clean, noAnswerSpace: true }, worksheet).pass).toBe(false)
  })

  it('applies cover rules: questions on a cover fail, answer space does not matter', () => {
    const cover = { pageNum: 1, type: 'cover' }
    expect(judgeReport({ ...clean, noAnswerSpace: true }, cover).pass).toBe(true)
    expect(judgeReport({ ...clean, hasQuestionsOnCover: true }, cover).pass).toBe(false)
  })

  it('tolerates an empty report', () => {
    expect(judgeReport(undefined, worksheet)).toEqual({ pass: true, issues: [] })
  })
})

describe('buildValidationPrompt', () => {
  it('lists the questions and says a student page has no answers', () => {
    const p = buildValidationPrompt(worksheet, { setTitle: 'Autumn Math' })
    expect(p).toContain('1. Q1')
    expect(p).toContain('2. Q2')
    expect(p).toContain('NO answers')
    expect(p).toContain('"Autumn Math"')
  })

  it('omits the question list for a cover', () => {
    expect(buildValidationPrompt({ type: 'cover', content: { questions: [{ num: 1, question: 'Q1' }] } })).not.toContain('1. Q1')
  })
})
