import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildCaption, notifyTelegram } from '../src/steps/notify-telegram.js'

const plan = {
  setTitle: 'Fractions: Add & Subtract!',
  gradeLevel: 'Grade 3',
  subject: 'Math',
  pageCount: 22,
  tptListing: {
    keywords: ['fractions', 'no prep', 'grade 3 math', 'common core', 'printable', 'extra'],
    suggestedPrice: 4.5,
  },
}

describe('buildCaption (MarkdownV2)', () => {
  const caption = buildCaption(plan, 'https://drive.google.com/drive/folders/abc123')

  it('escapes special characters in the bold title', () => {
    // ':', '&', '!' -> only '!' is special in V2; ':' and '&' are literal
    expect(caption).toContain('✅ *Fractions: Add & Subtract\\!*')
  })

  it('escapes the literal pipe between grade and subject', () => {
    expect(caption).toContain('📚 Grade 3 \\| Math')
  })

  it('escapes the dot in the price', () => {
    expect(caption).toContain('💰 Suggested: $4\\.50')
  })

  it('limits keywords to the first five', () => {
    expect(caption).toContain('🔑 fractions, no prep, grade 3 math, common core, printable')
    expect(caption).not.toContain('extra')
  })

  it('keeps the Drive link intact', () => {
    expect(caption).toContain('📁 [Open in Drive](https://drive.google.com/drive/folders/abc123)')
  })

  it('does not leave any unescaped bare period in the dynamic price line', () => {
    const priceLine = caption.split('\n').find(l => l.startsWith('💰'))
    expect(priceLine).not.toMatch(/[^\\]\.\d/)
  })
})

describe('notifyTelegram review message', () => {
  const realFetch = globalThis.fetch
  const calls = []
  const ok = { ok: true, text: async () => '' }

  beforeEach(() => {
    calls.length = 0
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return ok }
    process.env.TELEGRAM_BOT_TOKEN = 't'
    process.env.TELEGRAM_CHANNEL_ID = '-100channel'
    delete process.env.TELEGRAM_REVIEW_CHAT_ID
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('sends only the photo when there is no review text', async () => {
    await notifyTelegram(plan, Buffer.from('png'), 'https://drive/x')
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['sendPhoto'])
  })

  it('sends the review as plain text to the channel by default', async () => {
    await notifyTelegram(plan, Buffer.from('png'), 'https://drive/x', 'Review text')
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage'])
    const body = JSON.parse(calls[1].init.body)
    expect(body).toMatchObject({ chat_id: '-100channel', text: 'Review text' })
    expect(body.parse_mode).toBeUndefined()
  })

  it('routes the review to TELEGRAM_REVIEW_CHAT_ID when set', async () => {
    process.env.TELEGRAM_REVIEW_CHAT_ID = '12345'
    await notifyTelegram(plan, Buffer.from('png'), 'https://drive/x', 'Review text')
    expect(JSON.parse(calls[1].init.body).chat_id).toBe('12345')
  })
})
