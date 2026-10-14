import { describe, it, expect, vi } from 'vitest'
import { stripAnswerLeaks } from '../src/steps/generate-content.js'

vi.spyOn(console, 'warn').mockImplementation(() => {})
const page = (imageSpec, answers) => ({ pageNum: 2, imageSpec, questions: answers.map((answer, i) => ({ num: i + 1, question: 'q', answer })) })

describe('stripAnswerLeaks', () => {
  it('removes "= answer" after equations', () => {
    const d = stripAnswerLeaks({ pages: [page('Draw EXACTLY 2 spider icons for 1×2 = 2. Draw EXACTLY 8 spider icons for 4×2 = 8.', ['2', '8'])] })
    expect(d.pages[0].imageSpec).toBe('Draw EXACTLY 2 spider icons for 1×2. Draw EXACTLY 8 spider icons for 4×2.')
  })

  it('removes "– WORD" answers after crossword-style clues', () => {
    const d = stripAnswerLeaks({ pages: [page('Across: 1. Small web made by a house spider – COB. 6. Silk producer – SPIN.', ['COB', 'SPIN'])] })
    expect(d.pages[0].imageSpec).toBe('Across: 1. Small web made by a house spider. 6. Silk producer.')
  })

  it('keeps data values that answers are read from', () => {
    const spec = 'Table: Monday – 4 acorns, Tuesday – 7 acorns. Bar graph: Deer – height 6, Rabbits – height 8.'
    const d = stripAnswerLeaks({ pages: [page(spec, ['4', '7', 'Rabbits', '6'])] })
    expect(d.pages[0].imageSpec).toBe(spec)
  })

  it('keeps matching options listed in columns', () => {
    const spec = 'Left (top to bottom): Wolf spider, Orb-weaver. Right (top to bottom, shuffled): Forest, Grassland.'
    expect(stripAnswerLeaks({ pages: [page(spec, ['Grassland', 'Forest'])] }).pages[0].imageSpec).toBe(spec)
  })

  it('does not strip a number that merely starts the same ("= 20" when the answer is 2)', () => {
    const spec = 'Show 4×5 = 20.'
    expect(stripAnswerLeaks({ pages: [page(spec, ['2'])] }).pages[0].imageSpec).toBe(spec)
  })

  it('tolerates pages without a spec or questions', () => {
    expect(stripAnswerLeaks({ pages: [{ pageNum: 3, imageSpec: '' }, { pageNum: 4, imageSpec: 'x' }] }).pages[1].imageSpec).toBe('x')
  })
})

import { isLayoutQuestion } from '../src/steps/generate-content.js'

describe('isLayoutQuestion', () => {
  it('flags questions about where things sit on the page', () => {
    for (const q of [
      'Which habitat is listed second on the right side?',
      'True or False: The Wolf spider is shown at the top of the left column.',
      'The Orb-weaver appears third from the top on the left side.',
      'What word is at the bottom of the list?',
    ]) expect(isLayoutQuestion(q), q).toBe(true)
  })

  it('does not flag real questions', () => {
    for (const q of [
      'Which habitat does the wolf spider live in?',
      'Which direction does Alex patrol?',
      'What is the second safety rule spoken in the dialogue?',
      'How many pumpkins are in Row 2?',
      'Which animal had the most sightings?',
    ]) expect(isLayoutQuestion(q), q).toBe(false)
  })
})
