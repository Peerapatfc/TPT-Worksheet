import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../src/steps/generate-pages.js'

const basePlan = {
  setTitle: 'Fractions Fun',
  gradeLevel: 'Grade 3',
  pageCount: 6,
  themeColor: '#1B4F8A',
  pages: [
    { pageNum: 2, type: 'worksheet', content: { questions: [{ num: 1, question: 'What is 1/2 + 1/2?', answer: '1' }] } },
    { pageNum: 3, type: 'worksheet', content: { questions: [{ num: 2, question: 'What is 1/4 of 8?', answer: '2' }] } },
  ],
}

describe('buildPrompt', () => {
  it('always embeds the theme color in the frame and the header info', () => {
    const page = { pageNum: 1, type: 'cover', imagePrompt: 'a cover' }
    const prompt = buildPrompt(basePlan, page)
    expect(prompt).toContain('#1B4F8A')
    expect(prompt).toContain('"Fractions Fun" | Grade 3 | Page 1 of 6')
    expect(prompt).toContain('a cover')
  })

  it('includes exact visual data and questions for a worksheet page', () => {
    const page = {
      pageNum: 2,
      type: 'worksheet',
      imagePrompt: 'practice page',
      content: { imageSpec: 'bar chart: cats=5, dogs=8', questions: [{ num: 1, question: 'How many cats?', answer: '5' }] },
    }
    const prompt = buildPrompt(basePlan, page)
    expect(prompt).toContain('EXACT VISUAL DATA')
    expect(prompt).toContain('bar chart: cats=5, dogs=8')
    expect(prompt).toContain('Questions to include')
    expect(prompt).toContain('1. How many cats?')
  })

  it('renders an answer-key page with a labeled answer list and no diagrams', () => {
    const page = { pageNum: 4, type: 'answer_key', sourcePageNums: [2, 3], imagePrompt: 'answers' }
    const prompt = buildPrompt(basePlan, page)
    expect(prompt).toContain('Answer Key (Pages 2 & 3)')
    expect(prompt).toContain('do not redraw any diagrams')
    expect(prompt).toContain('1. What is 1/2 + 1/2? → 1')
    expect(prompt).toContain('2. What is 1/4 of 8? → 2')
  })
})
