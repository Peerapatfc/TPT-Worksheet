import { describe, it, expect } from 'vitest'
import { validate, largestEvenN } from '../src/steps/brainstorm.js'

// Build a structurally-valid plan: 1 cover + N worksheets + ceil(N/2) answer keys.
function makePlan({ worksheets = 10, answerKeys, subjectAreas = ['Math'], tags = ['Worksheets', 'Printables'], teachingDuration = '30 minutes' } = {}) {
  const pages = [{ pageNum: 1, type: 'cover' }]
  for (let i = 0; i < worksheets; i++) pages.push({ pageNum: i + 2, type: 'worksheet' })
  const ak = answerKeys ?? Math.ceil(worksheets / 2)
  for (let i = 0; i < ak; i++) pages.push({ pageNum: 100 + i, type: 'answer_key' })
  return {
    setTitle: 'Test Set',
    pages,
    tptListing: { title: 'Test | Grade 3', subjectAreas, tags, teachingDuration },
  }
}

describe('largestEvenN', () => {
  it('computes the largest even N fitting within pageMax', () => {
    expect(largestEvenN(40)).toBe(26) // floor(39/1.5)=26 (even)
    expect(largestEvenN(30)).toBe(18) // floor(29/1.5)=19 -> 18
    expect(largestEvenN(22)).toBe(14) // floor(21/1.5)=14
  })
})

describe('brainstorm validate — happy path', () => {
  it('accepts a well-formed small plan (16 pages)', () => {
    expect(() => validate(makePlan({ worksheets: 10 }), 30, 'small')).not.toThrow()
  })

  it('accepts a well-formed large plan', () => {
    expect(() => validate(makePlan({ worksheets: 14 }), 40, 'large')).not.toThrow()
  })
})

describe('brainstorm validate — structural failures', () => {
  it('rejects a missing setTitle', () => {
    const plan = makePlan()
    plan.setTitle = ''
    expect(() => validate(plan, 30, 'small')).toThrow(/setTitle/)
  })

  it('rejects a page count outside the tier range', () => {
    // 5 worksheets -> 1 + 5 + 3 = 9 pages, below small.min (15)
    expect(() => validate(makePlan({ worksheets: 5 }), 30, 'small')).toThrow(/out of range/)
  })

  it('rejects a wrong answer-key count', () => {
    // 12 worksheets -> 1 + 12 + 5 = 18 pages (in small range), but expected AK is ceil(12/2)=6
    const plan = makePlan({ worksheets: 12, answerKeys: 5 })
    expect(() => validate(plan, 30, 'small')).toThrow(/answer_key count/)
  })

  it('rejects answer keys not grouped at the end', () => {
    const plan = makePlan({ worksheets: 10 })
    // swap the last worksheet with the first answer key — counts stay valid,
    // only the "grouped at the end" rule should fail
    const lastWs = plan.pages.map(p => p.type).lastIndexOf('worksheet')
    const firstAk = plan.pages.findIndex(p => p.type === 'answer_key')
    ;[plan.pages[lastWs], plan.pages[firstAk]] = [plan.pages[firstAk], plan.pages[lastWs]]
    expect(() => validate(plan, 30, 'small')).toThrow(/grouped at the end/)
  })

  it('rejects when no subjectAreas survive taxonomy filtering', () => {
    expect(() => validate(makePlan({ subjectAreas: ['Not A Real Area'] }), 30, 'small')).toThrow(/subjectAreas/)
  })

  it('rejects when no tags survive taxonomy filtering', () => {
    expect(() => validate(makePlan({ tags: ['Bogus Tag'] }), 30, 'small')).toThrow(/tags/)
  })

  it('rejects a missing teachingDuration', () => {
    expect(() => validate(makePlan({ teachingDuration: '' }), 30, 'small')).toThrow(/teachingDuration/)
  })
})
