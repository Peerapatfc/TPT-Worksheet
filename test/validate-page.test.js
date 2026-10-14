import { describe, it, expect } from 'vitest'
import { judgeReport, buildValidationPrompt, compareQuestion } from '../src/steps/validate-page.js'

const worksheet = { pageNum: 12, type: 'worksheet', content: { questions: [{ num: 1, question: 'Q1' }, { num: 2, question: 'Q2' }] } }
const withQs = (r) => ({ ...r, questions: [{ num: 1, printed: 'Q1' }, { num: 2, printed: 'Q2' }] })
const clean = { questions: [], garbledText: false, noAnswerSpace: false, answersShown: false, headerMissing: false, hasQuestionsOnCover: false }

describe('judgeReport', () => {
  it('passes when every listed question is printed with the same numbers', () => {
    const r = judgeReport({ ...clean, questions: [{ num: 1, printed: 'Q1' }, { num: 2, printed: 'Q2 reworded' }], minorNotes: ['colors are bright'] }, worksheet)
    expect(r.pass).toBe(true)
    expect(r.issues).toEqual(['[minor] colors are bright'])
  })

  it('fails on a missing question or a changed number', () => {
    const page = { type: 'worksheet', content: { questions: [{ num: 1, question: 'A kid has 14 tickets.' }, { num: 2, question: 'Q2' }] } }
    const r = judgeReport({ ...clean, questions: [{ num: 1, printed: 'A kid has 18 tickets.' }, { num: 2, printed: '' }] }, page)
    expect(r.pass).toBe(false)
    expect(r.issues).toEqual(['[critical] q1 number_differs: listed "A kid has 14 tickets." / printed "A kid has 18 tickets."', '[critical] q2 missing'])
  })

  it('treats a listed question absent from the report as missing', () => {
    expect(judgeReport({ ...clean, questions: [{ num: 1, printed: 'Q1' }] }, worksheet).issues).toEqual(['[critical] q2 missing'])
  })

  it('fails on page-level defects', () => {
    expect(judgeReport(withQs({ ...clean, garbledText: true }), worksheet).pass).toBe(false)
    expect(judgeReport(withQs({ ...clean, headerMissing: true }), worksheet).pass).toBe(false)
    expect(judgeReport(withQs({ ...clean, noAnswerSpace: true }), worksheet).pass).toBe(false)
  })

  it('fails a student page that shows its own answers, but not a cover', () => {
    expect(judgeReport(withQs({ ...clean, answersShown: true }), worksheet)).toEqual({ pass: false, issues: ['[critical] answers shown on student page'] })
    expect(judgeReport({ ...clean, answersShown: true }, { type: 'cover' }).pass).toBe(true)
  })

  it('applies cover rules: questions on a cover fail, answer space does not matter', () => {
    const cover = { pageNum: 1, type: 'cover' }
    expect(judgeReport({ ...clean, noAnswerSpace: true }, cover).pass).toBe(true)
    expect(judgeReport({ ...clean, hasQuestionsOnCover: true }, cover).pass).toBe(false)
  })

  it('tolerates an empty report for a cover', () => {
    expect(judgeReport(undefined, { type: 'cover' })).toEqual({ pass: true, issues: [] })
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

describe('compareQuestion', () => {
  it('matches when numbers agree, regardless of wording or a Fact/Myth statement being false', () => {
    expect(compareQuestion('Statement 1: Spiders have six legs. Fact or Myth?', 'Spiders have six legs.')).toBe('match')
    expect(compareQuestion('Statement 7: There are over 45,000 known spider species.', '7. There are over 45,000 spider species.')).toBe('match')
    expect(compareQuestion('What is 1/2 of 8?', 'What is ½ of 8?')).toBe('match')
  })

  it('tolerates extra printed numbers but not a changed or dropped one', () => {
    expect(compareQuestion('Add 25 and 34.', 'Add 25 and 34. (2 points)')).toBe('match')
    expect(compareQuestion('A kid has 14 tickets.', 'A kid has 18 tickets.')).toBe('number_differs')
    expect(compareQuestion('9 children each win 3 apples.', '9 children each win apples.')).toBe('number_differs')
  })

  it('reports an empty transcription as missing', () => {
    expect(compareQuestion('Q', '')).toBe('missing')
    expect(compareQuestion('Q', undefined)).toBe('missing')
  })
})
