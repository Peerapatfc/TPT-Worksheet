import { describe, it, expect } from 'vitest'
import { resolveSourceQuestions } from '../src/lib/source-pages.js'

const q = (num) => ({ num, question: `q${num}?`, answer: `a${num}` })

const allPages = [
  { pageNum: 1, type: 'cover' },
  { pageNum: 2, type: 'worksheet', content: { questions: [q(1), q(2)] } },
  { pageNum: 3, type: 'worksheet', content: { questions: [q(3)] } },
  { pageNum: 4, type: 'answer_key' },
]

describe('resolveSourceQuestions', () => {
  it('resolves questions from explicit sourcePageNums', () => {
    const { nums, questions } = resolveSourceQuestions({ sourcePageNums: [2, 3] }, allPages)
    expect(nums).toEqual([2, 3])
    expect(questions.map(x => x.num)).toEqual([1, 2, 3])
  })

  it('supports the legacy single sourcePageNum', () => {
    const { nums, questions } = resolveSourceQuestions({ sourcePageNum: 2 }, allPages)
    expect(nums).toEqual([2])
    expect(questions.map(x => x.num)).toEqual([1, 2])
  })

  it('falls back to all questions when no source resolves', () => {
    const { nums, questions } = resolveSourceQuestions({}, allPages)
    expect(nums).toEqual([])
    expect(questions.map(x => x.num)).toEqual([1, 2, 3])
  })

  it('falls back to all questions when nums point to nonexistent pages', () => {
    const { questions } = resolveSourceQuestions({ sourcePageNums: [99] }, allPages)
    expect(questions.map(x => x.num)).toEqual([1, 2, 3])
  })

  it('returns empty when there are no pages at all', () => {
    const { nums, questions } = resolveSourceQuestions({}, [])
    expect(nums).toEqual([])
    expect(questions).toEqual([])
  })
})
