import { describe, it, expect } from 'vitest'
import { chunk, mergeValidations, isEmptyAnswerIssue, recheckWithSplit, repairCharts } from '../src/steps/generate-content.js'

describe('chunk', () => {
  it('splits into groups of at most size, preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })
  it('returns [] for an empty list', () => {
    expect(chunk([], 5)).toEqual([])
  })
})

describe('mergeValidations', () => {
  it('concatenates corrections and spec fixes, skipping failed (null) chunks', () => {
    const merged = mergeValidations([
      { pass: true, corrections: [{ pageNum: 2 }], imageSpecCorrections: [{ pageNum: 2 }] },
      null,
      { pass: false, corrections: [{ pageNum: 8 }] },
    ])
    expect(merged.corrections).toEqual([{ pageNum: 2 }, { pageNum: 8 }])
    expect(merged.imageSpecCorrections).toEqual([{ pageNum: 2 }])
    expect(merged.pass).toBe(false)
  })
})

describe('isEmptyAnswerIssue', () => {
  it('matches only blank-answer issues', () => {
    expect(isEmptyAnswerIssue('page 6 q1 empty answer')).toBe(true)
    expect(isEmptyAnswerIssue('page 6 q1 empty question')).toBe(false)
    expect(isEmptyAnswerIssue('page 3 missing')).toBe(false)
  })
})

describe('recheckWithSplit', () => {
  const pages = [2, 3, 4, 5, 6].map(pageNum => ({ pageNum }))
  const ok = (ps) => ({ pass: true, corrections: ps.map(p => ({ pageNum: p.pageNum })) })

  it('returns the validation untouched when the chunk call works', async () => {
    const check = async (_plan, ps) => ok(ps)
    const r = await recheckWithSplit({}, pages, check)
    expect(r.unchecked).toEqual([])
    expect(r.validation.corrections).toHaveLength(5)
  })

  it('retries halves when the whole chunk fails (413) and checks every page', async () => {
    const check = async (_plan, ps) => (ps.length > 2 ? null : ok(ps))
    const r = await recheckWithSplit({}, pages, check)
    expect(r.unchecked).toEqual([])
    expect(r.validation.corrections.map(c => c.pageNum)).toEqual([2, 3, 4, 5, 6])
  })

  it('reports only the pages that no call could check', async () => {
    const check = async (_plan, ps) => (ps.some(p => p.pageNum === 4) ? null : ok(ps))
    const r = await recheckWithSplit({}, pages, check)
    expect(r.unchecked).toEqual([4])
    expect(r.validation.corrections.map(c => c.pageNum)).toEqual([2, 3, 5, 6])
  })

  it('gives a lone page a second try', async () => {
    let calls = 0
    const check = async (_plan, ps) => (++calls < 2 ? null : ok(ps))
    const r = await recheckWithSplit({}, [{ pageNum: 4 }], check)
    expect(calls).toBe(2)
    expect(r.unchecked).toEqual([])
  })

  it('returns a null validation when everything fails', async () => {
    const r = await recheckWithSplit({}, pages, async () => null)
    expect(r.validation).toBeNull()
    expect(r.unchecked).toEqual([2, 3, 4, 5, 6])
  })
})

describe('repairCharts', () => {
  it('converts over-limit charts, drops unrepairable ones, and reports notes', () => {
    const data = { pages: [
      { pageNum: 8, chart: { type: 'bar', title: 't', categories: [{ label: 'a', value: 25 }, { label: 'b', value: 3 }] } },
      { pageNum: 9, chart: { type: 'bar', title: 't', categories: [{ label: 'a', value: 1.5 }, { label: 'b', value: 3 }] } },
      { pageNum: 10 },
    ] }
    const notes = repairCharts(data)
    expect(data.pages[0].chart.type).toBe('table')
    expect(data.pages[1].chart).toBeUndefined()
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatch(/^p8:/)
    expect(notes[1]).toMatch(/^p9:/)
  })
})
