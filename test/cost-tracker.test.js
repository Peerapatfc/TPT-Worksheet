import { describe, it, expect, beforeEach } from 'vitest'
import { recordUsage, estimateCost, costSummary, resetUsage } from '../src/lib/cost-tracker.js'

describe('cost-tracker', () => {
  beforeEach(() => resetUsage())

  it('accumulates chat and image usage shapes per step+model', () => {
    recordUsage('validate_page', 'gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 100 })
    recordUsage('validate_page', 'gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 100 })
    recordUsage('page_image', 'gpt-image-2', { input_tokens: 500, output_tokens: 4000 })
    const { byStep } = costSummary()
    const validate = byStep.find(e => e.step === 'validate_page')
    expect(validate).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 200 })
    expect(byStep.find(e => e.step === 'page_image')).toMatchObject({ calls: 1, inputTokens: 500, outputTokens: 4000 })
  })

  it('counts calls with missing usage as zero tokens', () => {
    recordUsage('page_image', 'gpt-image-2', undefined)
    expect(costSummary().byStep[0]).toMatchObject({ calls: 1, callsWithoutUsage: 1, inputTokens: 0, outputTokens: 0, usd: 0 })
  })

  it('estimates USD from the pricing table and returns null for unknown models', () => {
    const pricing = { m: { input: 2, output: 10 } }
    expect(estimateCost('m', 1_000_000, 100_000, pricing)).toBeCloseTo(3)
    expect(estimateCost('unknown', 1, 1, pricing)).toBeNull()
  })

  it('sorts most expensive first, totals priced steps, and lists unpriced models', () => {
    recordUsage('brainstorm', 'gpt-4o', { prompt_tokens: 1000, completion_tokens: 1000 })
    recordUsage('page_image', 'gpt-image-2', { input_tokens: 0, output_tokens: 10000 })
    recordUsage('mystery', 'some-new-model', { prompt_tokens: 10, completion_tokens: 10 })
    const summary = costSummary()
    expect(summary.byStep.map(e => e.step)).toEqual(['page_image', 'brainstorm', 'mystery'])
    expect(summary.totalUsd).toBeCloseTo(0.3 + 0.0125, 4)
    expect(summary.unpricedModels).toEqual(['some-new-model'])
  })
})
