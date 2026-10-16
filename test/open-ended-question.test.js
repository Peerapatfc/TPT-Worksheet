import { describe, it, expect } from 'vitest'
import { isOpenEndedQuestion, validateSchema } from '../src/steps/generate-content.js'

describe('isOpenEndedQuestion', () => {
  it.each([
    'Draw a leaf you saw this fall in the space provided.',
    'How many points (or lobes) does your leaf have?',
    'Did you include a leaf with three points? (yes/no)',
    'Write a sentence describing the colors in your collage.',
    'Write one word to describe its color.',
    'Describe the place where this plant lives.',
  ])('flags %s', q => expect(isOpenEndedQuestion(q)).toBe(true))

  it.each([
    'Which plant part takes in water from the soil?',
    'Write the missing number: 4 + __ = 9',
    'Which tool do you use to rub over the leaf?',
    'True or false: Leaves help plants make food.',
    'Name the season that follows fall.',
  ])('allows %s', q => expect(isOpenEndedQuestion(q)).toBe(false))

  it('is reported by validateSchema without counting as an empty answer', () => {
    const data = { pages: [{ pageNum: 2, questions: ['a', 'b', 'c', 'd'].map((x, i) => ({ num: i + 1, question: i === 0 ? 'Did you include a leaf?' : `${x}?`, answer: 'x' })) }] }
    expect(validateSchema(data, [{ pageNum: 2 }], 'small')).toEqual(['page 2 q1 open-ended question'])
  })
})
