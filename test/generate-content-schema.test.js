import { describe, it, expect } from 'vitest'
import { validateSchema } from '../src/steps/generate-content.js'

const contentPages = [
  { pageNum: 2, type: 'worksheet' },
  { pageNum: 3, type: 'worksheet' },
]

function page(pageNum, n) {
  return {
    pageNum,
    questions: Array.from({ length: n }, (_, i) => ({ num: i + 1, question: `q${i + 1}?`, answer: `a${i + 1}` })),
  }
}

describe('validateSchema', () => {
  it('passes when every page has enough non-empty questions', () => {
    const data = { pages: [page(2, 4), page(3, 4)] }
    expect(validateSchema(data, contentPages, 'small')).toEqual([])
  })

  it('flags a missing page', () => {
    const data = { pages: [page(2, 4)] }
    const issues = validateSchema(data, contentPages, 'small')
    expect(issues).toContain('page 3 missing')
  })

  it('flags a page with no questions', () => {
    const data = { pages: [page(2, 4), { pageNum: 3, questions: [] }] }
    const issues = validateSchema(data, contentPages, 'small')
    expect(issues).toContain('page 3 has no questions')
  })

  it('enforces a higher minimum for the large tier', () => {
    const data = { pages: [page(2, 4), page(3, 4)] } // 4 < 5
    const issues = validateSchema(data, contentPages, 'large')
    expect(issues.some(i => i.includes('min 5'))).toBe(true)
  })

  it('flags empty question and answer text', () => {
    const data = {
      pages: [
        page(2, 4),
        { pageNum: 3, questions: [{ num: 1, question: '  ', answer: '' }, { num: 2, question: 'ok?', answer: 'yes' }, { num: 3, question: 'a?', answer: 'b' }, { num: 4, question: 'c?', answer: 'd' }] },
      ],
    }
    const issues = validateSchema(data, contentPages, 'small')
    expect(issues).toContain('page 3 q1 empty question')
    expect(issues).toContain('page 3 q1 empty answer')
  })
})
