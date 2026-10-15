import { describe, it, expect, beforeEach } from 'vitest'
import { quotedPhrases, quotesMissingFromSpec } from '../src/lib/spec-consistency.js'
import { applyRecheck } from '../src/steps/generate-content.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'

const SPEC = 'Left (top to bottom): "Give me liberty, or give me death!"; "I have a dream that one day..."; "I am not afraid of storms, for I am learning how to sail my ship.". Right: Amelia Earhart; Martin Luther King Jr.; Patrick Henry.'

describe('quotedPhrases', () => {
  it('returns normalized quotes of 4+ words, ignoring short ones and either quote style', () => {
    expect(quotedPhrases('Who said “I have a dream that one day…”? Define "abolitionist". Match "Give me liberty!" now'))
      .toEqual(['i have a dream that one day'])
  })
})

describe('quotesMissingFromSpec', () => {
  it('finds quotes the spec never prints, ignoring case and punctuation', () => {
    const questions = [
      { question: 'Who said, “i have a dream that one day”?' },
      { question: 'Match the quote "It is better to be alone than in bad company" to the figure.' },
    ]
    expect(quotesMissingFromSpec(SPEC, questions)).toEqual(['it is better to be alone than in bad company'])
  })

  it('returns [] for a page without an imageSpec', () => {
    expect(quotesMissingFromSpec('', [{ question: 'Who said "to be or not to be"?' }])).toEqual([])
  })
})

describe('applyRecheck', () => {
  beforeEach(resetReviewNotes)

  const page = () => ({
    pageNum: 4,
    imageSpec: SPEC,
    questions: [
      { num: 1, question: 'Match the quote "Give me liberty, or give me death!" to the figure.', answer: 'Patrick Henry' },
      { num: 2, question: 'Who said "I have a dream that one day..."?', answer: 'Martin Luther King Jr.' },
      { num: 3, question: 'Who said "I am not afraid of storms, for I am learning how to sail my ship."?', answer: 'Amelia Earhart' },
    ],
  })
  const rewrite = { pageNum: 4, questionNum: 1, correctedQuestion: 'Match the quote "It is better to be alone than in bad company" to the figure.', correctedAnswer: 'George Washington', reason: 'Henry is not listed' }

  it('applies a plain answer correction', () => {
    const out = applyRecheck({ pages: [page()] }, { pass: false, corrections: [{ pageNum: 4, questionNum: 3, correctedAnswer: 'Louisa May Alcott', reason: 'wrong speaker' }] })
    expect(out.pages[0].questions[2].answer).toBe('Louisa May Alcott')
    expect(reviewNotes().map(n => n.kind)).toEqual(['answer_corrected'])
  })

  it('reverts a rewrite that cites a quote the picture would not show', () => {
    const out = applyRecheck({ pages: [page()] }, { pass: false, corrections: [rewrite] })
    expect(out.pages[0].questions[0]).toEqual(page().questions[0])
    expect(out.pages[0].imageSpec).toBe(SPEC)
    expect(reviewNotes().map(n => n.kind)).toEqual(['spec_mismatch'])
  })

  it('keeps the rewrite when the recheck also supplies a spec that prints the new quote', () => {
    const newSpec = SPEC.replace('"Give me liberty, or give me death!"', '"It is better to be alone than in bad company"')
    const out = applyRecheck({ pages: [page()] }, { pass: false, corrections: [rewrite], imageSpecCorrections: [{ pageNum: 4, correctedImageSpec: newSpec, reason: 'quote changed' }] })
    expect(out.pages[0].imageSpec).toBe(newSpec)
    expect(out.pages[0].questions[0].answer).toBe('George Washington')
    expect(reviewNotes().map(n => n.kind).sort()).toEqual(['image_spec_updated', 'question_rewritten'])
  })

  it('falls back to the original spec when a corrected spec drops a quote another question still cites', () => {
    const lossy = SPEC.replace('"I am not afraid of storms, for I am learning how to sail my ship."', '"Be the change you wish to see in the world."')
    const out = applyRecheck({ pages: [page()] }, { pass: false, corrections: [], imageSpecCorrections: [{ pageNum: 4, correctedImageSpec: lossy, reason: 'swap quote' }] })
    expect(out.pages[0].imageSpec).toBe(SPEC)
    expect(reviewNotes().map(n => n.kind)).toEqual(['spec_mismatch'])
  })

  it('ignores a layout-only rewrite (existing rule)', () => {
    const out = applyRecheck({ pages: [page()] }, { pass: true, corrections: [{ pageNum: 4, questionNum: 2, correctedQuestion: 'Is the Wolf spider shown at the top of the left column?', correctedAnswer: 'True', reason: 'x' }] })
    expect(out.pages[0].questions[1]).toEqual(page().questions[1])
  })

  it('returns the content untouched when there is nothing to apply', () => {
    const input = { pages: [page()] }
    expect(applyRecheck(input, { pass: true, corrections: [] })).toBe(input)
  })
})
