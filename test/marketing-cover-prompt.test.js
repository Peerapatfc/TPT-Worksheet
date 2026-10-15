import { describe, it, expect } from 'vitest'
import { buildMarketingCoverPrompt } from '../src/steps/generate-marketing-slides.js'

const plan = (pages) => ({
  setTitle: 'Exploring Historical Figures in October',
  gradeLevel: 'Grade 4',
  subject: 'Social Studies',
  themeColor: '#4B5320',
  tptListing: { title: 'Historical Figures Activities Packet | Grade 4 | No Prep Printable' },
  pages,
})

describe('buildMarketingCoverPrompt', () => {
  it('carries the cover page subjects so the illustration matches the set', () => {
    const prompt = buildMarketingCoverPrompt(plan([{ type: 'cover', imagePrompt: 'Harriet Tubman with a lantern and George Washington in a white wig' }]))
    expect(prompt).toContain('"Historical Figures Activities Packet"')
    expect(prompt).toContain('Grade 4 | Social Studies')
    expect(prompt).toContain('#4B5320')
    expect(prompt).toContain('Harriet Tubman with a lantern and George Washington in a white wig')
  })

  it('still builds a prompt when the plan has no cover page', () => {
    const prompt = buildMarketingCoverPrompt(plan([{ type: 'worksheet', imagePrompt: 'x' }]))
    expect(prompt).toContain('Historical Figures Activities Packet')
    expect(prompt).not.toContain('cover page')
  })
})
