// Hybrid cover: FLUX (Cloudflare Workers AI, free) draws a text-free colour
// illustration; code draws the title, subtitle, name line, grade pill and frame
// (svg-templates.js hybridCoverSvg) so cover text is always spelled exactly.
import sharp from 'sharp'
import { generateIllustration, hasCloudflareCreds } from '../llm/flux.js'
import { hybridCoverSvg, renderSvg } from './svg-templates.js'

export const ILLUSTRATION_STYLE = "cute flat-color children's book illustration, bright colors, clean outlines, white background, vignette composition centered on white"
const NO_TEXT = 'no text, no letters, no numbers'
export const MAX_PROMPT_CHARS = 900

/** COVER_RENDERER=hybrid and Cloudflare credentials present. Pure. */
export const useHybridCover = (env = process.env) =>
  String(env.COVER_RENDERER ?? '').trim().toLowerCase() === 'hybrid' && hasCloudflareCreds(env)

// Phrases about printed text, typography or page layout — the template owns those.
const TEXT_WORDS = 'titles?|headings?|headers?|header bars?|subtitles?|text|lettering|typography|fonts?|words?|letters?|captions?|labels?|banners?|name(?: and date)? lines?|date lines?|signature|logo'
const TEXT_PHRASE = new RegExp(`(?:\\b(?:with|featuring|showing|including|include|includes|and|plus)\\s+)?(?:\\b(?:a|an|the)\\s+)?(?:\\b(?:large|big|bold|bright|decorative|colorful|colourful|fun|playful|centered|clear|cartoon|simple|student|students')\\s+)*\\b(?:${TEXT_WORDS})\\b(?:(?!\\s(?:and|with|plus)\\s+(?:a|an|the|some|two|three|four|five)\\b)[^,.;:!?])*`, 'gi')
const LAYOUT_PHRASE = /(?:\b(?:with|and|around|along|surrounding|framing|in)\s+)?(?:\b(?:a|an|the)\s+)?(?:\b(?:thick|thin|decorative|colorful|solid|thematic)\s+)*\b(?:borders?|frames?|margins?)\b[^,.;:!?]*/gi
const PAGE_WORDS = /\b(?:(?:a|an|the)\s+)?(?:(?:bright|colorful|colourful|fun|engaging|cheerful|vibrant|professional)\s+)*(?:cover page|cover|title page|page|worksheets?|printables?)\b(?:\s+(?:with|featuring|showing|that shows|of))?/gi
const POSITION = /\b(?:at|on|across|along|in) the (?:very )?(?:top|bottom|center|centre|middle|left|right)(?: of the (?:page|cover))?\b/gi
// Quoted strings are almost always the set title or other printed words.
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’|(^|[\s(:])'[^']{2,}?'(?=[\s.,;:)!?]|$)/g
const DROP_SENTENCE = /\b(?:questions?|answers?|exercises?|students? (?:write|fill)|blank)\b/i

function tidy(s) {
  return s
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^(?:[\s,;:.\-–—]|\b(?:and|with|plus)\b)+|[\s,;:\-–—]+$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Turn the cover page's imagePrompt (brainstorm names the exact subjects to draw)
 * into the subject part of a FLUX prompt: quoted titles, text/typography, border,
 * page-layout and position phrases are removed. Falls back to the topic when
 * nothing usable is left. Pure — exported for unit testing.
 */
export function coverSubjects(plan) {
  const cover = plan.pages?.find(p => p.type === 'cover')
  const raw = String(cover?.imagePrompt ?? '').replace(QUOTED, '$1')
  const sentences = raw.split(/(?<=[.!?;])\s+/)
    .filter(s => !DROP_SENTENCE.test(s))
    .map(s => tidy(s.replace(TEXT_PHRASE, '').replace(LAYOUT_PHRASE, '').replace(POSITION, '').replace(PAGE_WORDS, '')))
    .filter(s => /[a-z]{3}/i.test(s))
    .map(s => (/[.!?]$/.test(s) ? s : `${s}.`))
  const subjects = tidy(sentences.join(' '))
  if (subjects.length >= 15) return subjects
  const topic = [plan.subject, plan.setTitle].filter(Boolean).join(': ')
  return `a cheerful scene of children's book characters and objects about ${topic || 'learning'}`
}

/** Full FLUX prompt: style + subjects + no-text guard, capped at MAX_PROMPT_CHARS on a word boundary. Pure. */
export function buildIllustrationPrompt(plan) {
  const head = `${ILLUSTRATION_STYLE}, ${NO_TEXT}. `
  const tail = `. ${NO_TEXT}`
  const budget = MAX_PROMPT_CHARS - head.length - tail.length
  let subjects = coverSubjects(plan).replace(/[.\s]+$/, '')
  if (subjects.length > budget) subjects = subjects.slice(0, budget).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '')
  return `${head}${subjects}${tail}`
}

/** Cover subtitle drawn under the title. Pure. */
export const coverSubtitle = (plan) => plan.subject ? `${plan.subject} Worksheets & Activities` : 'Printable Worksheets & Activities'

/**
 * Prepare a raw FLUX image for compositing: crop the bottom 7% (FLUX hallucinates
 * watermark text there), turn near-white into transparency (soft ramp), fade the
 * bottom edge so the crop line never shows, then trim empty margins.
 * @returns {Promise<{ png: Buffer, width: number, height: number }>}
 */
export async function prepareIllustration(raw) {
  const meta = await sharp(raw).metadata()
  const height = Math.floor(meta.height * 0.93)
  const { data, info } = await sharp(raw)
    .extract({ left: 0, top: 0, width: meta.width, height })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  // Only near-white connected to the image edge is background: white subjects
  // (polar bear, snow, clouds) enclosed by outlines stay opaque.
  const light = (p) => Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) > 215
  const bg = new Uint8Array(W * H)
  const stack = []
  const seed = (p) => { if (!bg[p] && light(p)) { bg[p] = 1; stack.push(p) } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (stack.length) {
    const p = stack.pop()
    const x = p % W
    if (x > 0) seed(p - 1)
    if (x < W - 1) seed(p + 1)
    if (p >= W) seed(p - W)
    if (p < (H - 1) * W) seed(p + W)
  }
  const fadeFrom = Math.floor(H * 0.9)
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i], data[i + 1], data[i + 2])
    let a = !bg[i / 4] ? 255 : m >= 245 ? 0 : Math.round(255 * (245 - m) / 30)
    const row = Math.floor(i / 4 / W)
    if (row > fadeFrom) a = Math.round(a * (info.height - row) / (info.height - fadeFrom))
    data[i + 3] = a
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png().toBuffer()
  const out = await sharp(png).metadata()
  return { png, width: out.width, height: out.height }
}

/**
 * Render the cover page PNG (1024×1536). `generate` is injectable for tests.
 * Throws on any FLUX/compositing failure — the caller falls back to gpt-image-2.
 */
export async function renderHybridCover(plan, { generate = generateIllustration } = {}) {
  const raw = await generate(buildIllustrationPrompt(plan))
  const ill = await prepareIllustration(raw)
  const svg = hybridCoverSvg({
    title: plan.setTitle,
    subtitle: coverSubtitle(plan),
    gradeLabel: plan.gradeLevel,
    pageCount: plan.pageCount,
    color: plan.themeColor,
    illustration: { href: `data:image/png;base64,${ill.png.toString('base64')}`, width: ill.width, height: ill.height },
  })
  return renderSvg(svg)
}
