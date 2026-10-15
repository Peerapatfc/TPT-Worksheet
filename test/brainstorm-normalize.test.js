import { describe, it, expect } from 'vitest'
import { normalizeAnswerKeys, sanitizeStandardsClaims, syncListingCounts, validate } from '../src/steps/brainstorm.js'

const page = (pageNum, type, extra = {}) => ({ pageNum, type, filename: `${type}_${pageNum}`, imagePrompt: type, ...extra })

describe('normalizeAnswerKeys', () => {
  it('rebuilds a miscounted answer-key section (10 worksheets, model gave 4 keys)', () => {
    const pages = [page(1, 'cover')]
    for (let i = 2; i <= 11; i++) pages.push(page(i, 'worksheet'))
    for (let i = 12; i <= 15; i++) pages.push(page(i, 'answer_key'))
    const plan = normalizeAnswerKeys({ pages })

    const keys = plan.pages.filter(p => p.type === 'answer_key')
    expect(keys).toHaveLength(5)
    expect(keys.map(k => k.sourcePageNums)).toEqual([[2, 3], [4, 5], [6, 7], [8, 9], [10, 11]])
    expect(keys.map(k => k.pageNum)).toEqual([12, 13, 14, 15, 16])
    expect(keys[0].filename).toBe('answer_key_page_1')
    expect(plan.pages.map(p => p.pageNum)).toEqual([...Array(16).keys()].map(i => i + 1))
  })

  it('moves stray answer keys to the end and gives an odd last page its own key', () => {
    const plan = normalizeAnswerKeys({ pages: [
      page(1, 'cover'), page(2, 'worksheet'), page(3, 'answer_key'), page(4, 'activity'), page(5, 'worksheet'),
    ] })
    expect(plan.pages.map(p => p.type)).toEqual(['cover', 'worksheet', 'activity', 'worksheet', 'answer_key', 'answer_key'])
    expect(plan.pages.filter(p => p.type === 'answer_key').map(k => k.sourcePageNums)).toEqual([[2, 3], [4]])
  })

  it('produces a plan that passes validate for the small tier', () => {
    const pages = [page(1, 'cover')]
    for (let i = 2; i <= 11; i++) pages.push(page(i, 'worksheet'))
    pages.push(page(12, 'answer_key'))
    const plan = normalizeAnswerKeys({
      setTitle: 'T', pages,
      tptListing: { title: 'T | Grade 3', subjectAreas: ['Arithmetic'], tags: ['Worksheets'], teachingDuration: '30 minutes' },
    })
    expect(() => validate(plan, 30, 'small')).not.toThrow()
  })
})

describe('sanitizeStandardsClaims', () => {
  const listing = () => ({
    title: 'Halloween Safety Worksheets | Grade 3 | No Prep Common Core Printable',
    description: 'Help students stay safe. Includes 10 pages. Aligned to Common Core State Standards (CCSS). Answer key included for all pages.',
    keywords: ['no prep worksheets', 'common core worksheets', 'halloween safety'],
  })

  it('strips CCSS claims when the plan has no standards (e.g. Health)', () => {
    const plan = sanitizeStandardsClaims({ educationStandards: { framework: null, codes: [] }, tptListing: listing() })
    expect(plan.tptListing.description).toBe('Help students stay safe. Includes 10 pages. Answer key included for all pages.')
    expect(plan.tptListing.title).toBe('Halloween Safety Worksheets | Grade 3 | No Prep Printable')
    expect(plan.tptListing.keywords).toEqual(['no prep worksheets', 'halloween safety'])
  })

  it('keeps CCSS claims when the plan lists CCSS codes', () => {
    const plan = sanitizeStandardsClaims({ educationStandards: { framework: 'CCSS', codes: ['CCSS.MATH.CONTENT.3.OA.A.1'] }, tptListing: listing() })
    expect(plan.tptListing).toEqual(listing())
  })

  it('strips CCSS but keeps NGSS for a science set', () => {
    const plan = sanitizeStandardsClaims({
      educationStandards: { framework: 'NGSS', codes: ['3-LS1-1'] },
      tptListing: { title: 'Plants | Grade 3 | Common Core', description: 'Aligned to NGSS. Also Common Core aligned. Fun.', keywords: [] },
    })
    expect(plan.tptListing.description).toBe('Aligned to NGSS. Fun.')
    expect(plan.tptListing.title).toBe('Plants | Grade 3')
  })

  it('treats a framework with no codes as unbacked', () => {
    const plan = sanitizeStandardsClaims({ educationStandards: { framework: 'CCSS', codes: [] }, tptListing: listing() })
    expect(plan.tptListing.description).not.toMatch(/Common Core/)
  })
})

describe('syncListingCounts', () => {
  const planWith = (description) => ({
    pages: [{ type: 'cover' }, ...Array(11).fill({ type: 'worksheet' }), ...Array(6).fill({ type: 'answer_key' })],
    tptListing: { description },
  })

  it('overwrites a wrong page count and worksheet count with the real ones', () => {
    const plan = syncListingCounts(planWith('This 16-page set includes 10 no-prep worksheets and activities plus answer keys.'))
    expect(plan.tptListing.description).toBe('This 18-page set includes 11 no-prep worksheets and activities plus answer keys.')
  })

  it('keeps singular/plural wording and leaves unrelated numbers alone', () => {
    const plan = syncListingCounts(planWith('A 20 page packet with 9 worksheet/activity pages and 50 questions for 3 centers.'))
    expect(plan.tptListing.description).toBe('A 18 page packet with 11 worksheet/activity pages and 50 questions for 3 centers.')
  })

  it('does nothing without a description', () => {
    expect(syncListingCounts({ pages: [], tptListing: {} })).toEqual({ pages: [], tptListing: {} })
  })
})

describe('sanitizeStandardsClaims — vague claims', () => {
  const run = (educationStandards, description, keywords = []) => {
    const plan = { educationStandards, tptListing: { title: 'T | Grade 4', description, keywords } }
    return sanitizeStandardsClaims(plan).tptListing
  }

  it('drops "aligned to common education standards" and "standards aligned" when no framework is named', () => {
    const listing = run({ framework: null, codes: [] }, 'Great packet. Aligned to common education standards. Print and go.', ['education standards aligned', 'print and go'])
    expect(listing.description).toBe('Great packet. Print and go.')
    expect(listing.keywords).toEqual(['print and go'])
  })

  it('keeps a backed CCSS sentence', () => {
    const listing = run({ framework: 'CCSS', codes: ['CCSS.MATH.CONTENT.4.NBT.B.4'] }, 'Great packet. Aligned to Common Core State Standards (CCSS). Print and go.', ['common core math'])
    expect(listing.description).toContain('Aligned to Common Core State Standards (CCSS).')
    expect(listing.keywords).toEqual(['common core math'])
  })
})
