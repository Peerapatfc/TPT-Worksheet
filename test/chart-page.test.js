import { describe, it, expect, vi } from 'vitest'
import { chartPageSvg, validateChart, repairChart } from '../src/lib/chart-page.js'
import { generatePages, isChartPage } from '../src/steps/generate-pages.js'
import { validateSchema } from '../src/steps/generate-content.js'

const plan = { setTitle: 'Autumn & Math', gradeLevel: 'Grade 2', pageCount: 6, themeColor: '#C2410C' }
const questions = [{ num: 1, question: 'How many acorns does Squirrel B have?', answer: '5' }]
const cats = (...values) => values.map((value, i) => ({ label: `Cat ${i + 1}`, value }))
const page = (chart) => ({ pageNum: 3, type: 'worksheet', filename: 'w', content: { chart, questions } })
const count = (svg, cls) => (svg.match(new RegExp(`class="${cls}"`, 'g')) ?? []).length

describe('chartPageSvg', () => {
  it('draws exactly one icon per unit in a picture graph (plus one key icon)', () => {
    const svg = chartPageSvg(plan, page({ type: 'pictograph', title: 'Acorns', icon: 'star', unit: 'acorn', categories: cats(3, 5, 0, 12) }))
    expect(count(svg, 'chart-icon')).toBe(20)
    expect(count(svg, 'chart-key')).toBe(1)
    expect(svg).toContain('= 1 acorn')
  })

  it.each(['circle', 'star', 'square', 'heart', 'triangle'])('renders the %s icon', (icon) => {
    expect(count(chartPageSvg(plan, page({ type: 'pictograph', title: 't', icon, categories: cats(2, 1) })), 'chart-icon')).toBe(3)
  })

  it('draws one bar per category with heights proportional to the values', () => {
    const svg = chartPageSvg(plan, page({ type: 'bar', title: 'Animals', unit: 'animals', categories: cats(6, 8, 4, 2) }))
    const bars = [...svg.matchAll(/<rect [^>]*height="([\d.]+)"[^>]*class="chart-bar" data-value="(\d+)"/g)]
    expect(bars.map(b => Number(b[2]))).toEqual([6, 8, 4, 2])
    const perUnit = Number(bars[0][1]) / 6
    for (const [, h, v] of bars) expect(Number(h)).toBeCloseTo(perUnit * Number(v), 5)
  })

  it('draws one table row per category and prints the values', () => {
    const svg = chartPageSvg(plan, page({ type: 'table', title: 'Days', labelHeader: 'Day', valueHeader: 'Acorns', categories: cats(4, 7, 5) }))
    expect(count(svg, 'chart-row')).toBe(3)
    for (const v of ['>4<', '>7<', '>5<', '>Day<', '>Acorns<']) expect(svg).toContain(v)
  })

  it('never truncates a long chart title', () => {
    const title = 'Woodland animals spotted on a nature walk through the autumn forest'
    expect(chartPageSvg(plan, page({ type: 'bar', title, categories: cats(1, 2) }))).toContain(`>${title}<`)
  })

  it('prints the questions with answer lines but never the answers', () => {
    const svg = chartPageSvg(plan, page({ type: 'pictograph', title: 't', categories: cats(1, 2) }))
    expect(svg).toContain('How many acorns does Squirrel B have?')
    expect(svg).toContain('Page 3 of 6')
    expect(svg).toContain('Autumn &amp; Math')
  })
})

describe('validateChart', () => {
  it('accepts valid charts', () => {
    expect(validateChart({ type: 'bar', title: 't', categories: cats(1, 20) })).toEqual([])
  })

  it('rejects unknown types, too few/many categories, and bad values', () => {
    expect(validateChart({ type: 'pie', categories: cats(1, 2) })[0]).toMatch(/must be one of/)
    expect(validateChart({ type: 'bar', categories: cats(1) })[0]).toMatch(/at least 2/)
    expect(validateChart({ type: 'pictograph', categories: cats(1, 2, 3, 4, 5, 6, 7) })[0]).toMatch(/7 categories/)
    expect(validateChart({ type: 'pictograph', categories: cats(13, 2) })[0]).toMatch(/0–12/)
    expect(validateChart({ type: 'bar', categories: [{ label: 'a', value: 2.5 }, { label: '', value: 1 }] })).toHaveLength(2)
  })
})

describe('chart page routing', () => {
  it('treats only worksheet/activity pages with a valid chart as chart pages', () => {
    expect(isChartPage(page({ type: 'bar', title: 't', categories: cats(1, 2) }))).toBe(true)
    expect(isChartPage(page({ type: 'bar', title: 't', categories: cats(1) }))).toBe(false)
    expect(isChartPage({ type: 'worksheet', content: { questions } })).toBe(false)
  })

  it('renders chart pages and answer keys without any image API call', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const p = {
      ...plan,
      pages: [
        { ...page({ type: 'bar', title: 't', categories: cats(3, 5) }), pageNum: 1 },
        { pageNum: 2, type: 'answer_key', filename: 'ak', sourcePageNums: [1] },
      ],
    }
    const out = await generatePages(p)
    expect(out.map(x => x.pageNum)).toEqual([1, 2])
    for (const x of out) expect(x.buffer.subarray(1, 4).toString()).toBe('PNG')
  })
})

describe('validateSchema with charts', () => {
  it('reports chart problems so generateContent retries', () => {
    const qs = Array.from({ length: 4 }, (_, i) => ({ num: i + 1, question: 'q', answer: 'a' }))
    const issues = validateSchema({ pages: [{ pageNum: 2, questions: qs, chart: { type: 'pictograph', title: 't', categories: cats(20, 1) } }] }, [{ pageNum: 2 }])
    expect(issues).toEqual(['page 2 chart value for "Cat 1" must be a whole number 0–12 (got 20)'])
  })
})

describe('repairChart', () => {
  it('keeps a valid chart as is', () => {
    const chart = { type: 'bar', title: 't', categories: cats(1, 20) }
    expect(repairChart(chart)).toEqual({ chart, changed: false })
  })

  it('turns an over-limit bar chart into a table with the same numbers', () => {
    const chart = { type: 'bar', title: 'Sales', unit: 'item', categories: cats(40, 35, 50) }
    const { chart: fixed, changed } = repairChart(chart)
    expect(changed).toBe(true)
    expect(fixed.type).toBe('table')
    expect(fixed.categories).toEqual(chart.categories)
    expect(validateChart(fixed)).toEqual([])
  })

  it('cannot repair fractional values or too many rows', () => {
    expect(repairChart({ type: 'bar', categories: [{ label: 'a', value: 2.5 }, { label: 'b', value: 1 }] }).chart).toBeNull()
    expect(repairChart({ type: 'bar', categories: cats(30, 1, 2, 3, 4, 5, 6, 7, 8) }).chart).toBeNull()
  })
})

describe('table header', () => {
  it('shrinks a long value header instead of cutting it', () => {
    const svg = chartPageSvg(plan, { pageNum: 2, content: { questions: [], chart: { type: 'table', title: 't', valueHeader: 'Number of Attendees', categories: cats(1, 2) } } })
    expect(svg).toContain('Number of Attendees')
  })
})
