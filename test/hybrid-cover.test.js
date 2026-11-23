import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { hybridCoverSvg, fitCoverTitle, tint, PAGE_W } from '../src/lib/svg-templates.js'
import { coverSubjects, buildIllustrationPrompt, useHybridCover, renderHybridCover, MAX_PROMPT_CHARS } from '../src/lib/hybrid-cover.js'
import { generateIllustration, hasCloudflareCreds } from '../src/llm/flux.js'
import { generateCoverPage } from '../src/steps/generate-pages.js'
import { reviewNotes, resetReviewNotes } from '../src/lib/review-notes.js'
import { costSummary, resetUsage } from '../src/lib/cost-tracker.js'

const CREDS = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'tok' }
const titleText = (svg) => [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)" font-weight="bold"[^>]*fill="#1B4F8A" text-anchor="middle">([^<]*)</g)].map(m => m[2])

describe('hybridCoverSvg', () => {
  const base = { title: 'Fractions & Fun', subtitle: 'Math <Worksheets>', gradeLabel: 'Grade 3', pageCount: 18, color: '#1B4F8A' }

  it('prints the exact title, escaped, plus subtitle, name line and grade pill', () => {
    const svg = hybridCoverSvg(base)
    expect(titleText(svg).join(' ')).toBe('Fractions &amp; Fun')
    expect(svg).toContain('Math &lt;Worksheets&gt;')
    expect(svg).toContain('Grade 3 | 18 Printable Pages')
    expect(svg).toContain('Name:')
    expect(svg).not.toMatch(/<Worksheets>/)
  })

  it('escapes quotes/ampersands in the illustration href and embeds it', () => {
    const svg = hybridCoverSvg({ ...base, illustration: { href: 'data:image/png;base64,AA"&', width: 800, height: 600 } })
    expect(svg).toContain('href="data:image/png;base64,AA&quot;&amp;"')
  })

  it('fits the illustration inside the page width', () => {
    const svg = hybridCoverSvg({ ...base, illustration: { href: 'data:x', width: 3000, height: 1000 } })
    const [, x, , w] = svg.match(/<image x="(-?\d+)" y="(-?\d+)" width="(\d+)"/)
    expect(+x).toBeGreaterThanOrEqual(0)
    expect(+x + +w).toBeLessThanOrEqual(PAGE_W)
  })

  it('shrinks and wraps a long title so no line overflows', () => {
    const title = 'The Incredibly Long and Wonderful Adventures of Ancient Egyptian Pharaohs and Their Pyramids'
    const svg = hybridCoverSvg({ ...base, title })
    const lines = titleText(svg)
    expect(lines.join(' ')).toBe(title)
    const size = +svg.match(/font-size="(\d+)" font-weight="bold"[^>]*fill="#1B4F8A"/)[1]
    expect(size).toBeLessThan(96)
    for (const l of lines) expect(l.length * size * 0.7).toBeLessThanOrEqual(PAGE_W - 180)
  })

  it('hard-splits a single giant word instead of overflowing', () => {
    const { size, lines } = fitCoverTitle('Supercalifragilisticexpialidocious'.repeat(3), 844)
    for (const l of lines) expect(l.length * size * 0.7).toBeLessThanOrEqual(844)
  })

  it('falls back to the default color for an invalid hex and renders without an illustration', () => {
    const svg = hybridCoverSvg({ ...base, color: 'red"/>' })
    expect(svg).not.toContain('red"/>')
    expect(svg).not.toContain('<image')
    expect(tint('#000000', 0.5)).toBe('#808080')
  })
})

describe('cover illustration prompt', () => {
  const plan = (imagePrompt) => ({ subject: 'Science', setTitle: 'Arctic Animals', pages: [{ type: 'cover', imagePrompt }] })

  it('strips quoted titles, text, name lines and borders but keeps the named subjects', () => {
    const s = coverSubjects(plan("A bright cover page with the title 'Exploring the Solar System' in large bold letters at the top, illustrations of the Sun, Earth, Mars and Saturn with its rings. Show no other planets. Include a name and date line below the title. Thick decorative border in navy."))
    expect(s).toContain('Sun, Earth, Mars and Saturn')
    expect(s).toContain('Show no other planets')
    expect(s).not.toMatch(/Exploring the Solar System|title|letters|name|date line|border|cover page/i)
  })

  it('keeps subjects that follow an unquoted title in the same clause', () => {
    const s = coverSubjects(plan('Colorful cover featuring the title Fall Fractions Fun and a pumpkin pie cut into slices, apples and leaves around the border.'))
    expect(s).toContain('pumpkin pie')
    expect(s).not.toMatch(/title|border/i)
  })

  it('falls back to the topic when nothing but layout is left', () => {
    expect(coverSubjects(plan('Title page with text only.'))).toContain('Science: Arctic Animals')
    expect(coverSubjects({ setTitle: 'X', pages: [] })).toContain('X')
  })

  it('wraps subjects in the no-text style and caps the length', () => {
    const p = buildIllustrationPrompt(plan('a fox and an owl '.repeat(200)))
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    expect(p).toMatch(/^cute flat-color children's book illustration/)
    expect(p).toMatch(/no text, no letters, no numbers$/)
  })
})

describe('useHybridCover gating', () => {
  it('needs COVER_RENDERER=hybrid and both credentials', () => {
    expect(useHybridCover({})).toBe(false)
    expect(useHybridCover({ ...CREDS })).toBe(false)
    expect(useHybridCover({ COVER_RENDERER: 'hybrid' })).toBe(false)
    expect(useHybridCover({ COVER_RENDERER: 'hybrid', CLOUDFLARE_ACCOUNT_ID: 'a' })).toBe(false)
    expect(useHybridCover({ COVER_RENDERER: ' Hybrid ', ...CREDS })).toBe(true)
    expect(hasCloudflareCreds(CREDS)).toBe(true)
  })
})

describe('generateCoverPage routing', () => {
  const plan = { setTitle: 'T', pageCount: 7, pages: [] }
  const page = { pageNum: 1, type: 'cover', filename: 'cover' }
  beforeEach(() => { resetReviewNotes(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })

  it('uses the legacy gpt-image-2 path when the flag is off or creds are missing', async () => {
    for (const env of [{}, { COVER_RENDERER: 'hybrid' }, { ...CREDS, COVER_RENDERER: 'gpt' }]) {
      const hybrid = vi.fn()
      const legacy = vi.fn().mockResolvedValue({ ...page, buffer: Buffer.from('legacy') })
      const out = await generateCoverPage(plan, page, { env, hybrid, legacy })
      expect(hybrid).not.toHaveBeenCalled()
      expect(out.buffer.toString()).toBe('legacy')
    }
  })

  it('uses the hybrid renderer when enabled', async () => {
    const legacy = vi.fn()
    const out = await generateCoverPage(plan, page, { env: { COVER_RENDERER: 'hybrid', ...CREDS }, hybrid: async () => Buffer.from('hybrid'), legacy })
    expect(out).toMatchObject({ pageNum: 1, type: 'cover', filename: 'cover' })
    expect(out.buffer.toString()).toBe('hybrid')
    expect(legacy).not.toHaveBeenCalled()
  })

  it('falls back to legacy with a review note when FLUX throws', async () => {
    const legacy = vi.fn().mockResolvedValue({ ...page, buffer: Buffer.from('legacy') })
    const out = await generateCoverPage(plan, page, {
      env: { COVER_RENDERER: 'hybrid', ...CREDS },
      hybrid: async () => { throw new Error('FLUX HTTP 500') },
      legacy,
    })
    expect(out.buffer.toString()).toBe('legacy')
    expect(reviewNotes()).toEqual([expect.objectContaining({ kind: 'fallback', message: expect.stringContaining('FLUX HTTP 500') })])
  })
})

describe('generateIllustration (mock fetch)', () => {
  beforeEach(() => resetUsage())
  const ok = (b64) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: { image: b64 } }) })
  const fail = (status) => ({ ok: false, status, text: async () => JSON.stringify({ errors: [{ message: 'boom' }] }) })

  it('POSTs prompt + steps with the bearer token and returns the decoded image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(Buffer.from('jpeg').toString('base64')))
    const buf = await generateIllustration('a fox', { env: CREDS, fetchImpl })
    expect(buf.toString()).toBe('jpeg')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/black-forest-labs/flux-1-schnell')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ prompt: 'a fox', steps: 8 })
    const entry = costSummary().byStep.find(e => e.step === 'cover_illustration')
    expect(entry).toMatchObject({ calls: 1, usd: 0 })
  })

  it('retries 429/5xx and throws on a non-retryable error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok('AA=='))
    await generateIllustration('x', { env: CREDS, fetchImpl, retry: { baseDelayMs: 0 } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const bad = vi.fn().mockResolvedValue(fail(400))
    await expect(generateIllustration('x', { env: CREDS, fetchImpl: bad, retry: { baseDelayMs: 0 } })).rejects.toMatchObject({ status: 400 })
    expect(bad).toHaveBeenCalledTimes(1)
  })

  it('throws without credentials', async () => {
    await expect(generateIllustration('x', { env: {} })).rejects.toThrow(/CLOUDFLARE/)
  })
})

describe('renderHybridCover', () => {
  it('composites a generated illustration into a 1024x1536 PNG', async () => {
    const fake = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: '#cc3300' } }, left: 78, top: 60 }])
      .jpeg().toBuffer()
    const generate = vi.fn().mockResolvedValue(fake)
    const png = await renderHybridCover({ setTitle: 'Autumn Math', subject: 'Math', gradeLevel: 'Grade 2', pageCount: 9, themeColor: '#B5530E', pages: [{ type: 'cover', imagePrompt: 'a squirrel holding an acorn' }] }, { generate })
    const meta = await sharp(png).metadata()
    expect(meta).toMatchObject({ format: 'png', width: 1024, height: 1536 })
    expect(generate.mock.calls[0][0]).toContain('squirrel holding an acorn')
  })
})
