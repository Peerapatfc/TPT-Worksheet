// FLUX spot illustrations for hybrid worksheet/activity pages (PAGE_RENDERER=hybrid).
// Generalises the hybrid cover: a short subject is derived in code from the page's
// brainstorm imagePrompt (or the set/page titles), wrapped in a fixed style
// template, drawn by FLUX.1 schnell (Cloudflare Workers AI, free) and prepared like
// the cover art (bottom-7% crop, edge-connected near-white → transparent, trim).
// Illustrations are decorative only: no question ever depends on them.
import { generateIllustration } from '../llm/flux.js'
import { prepareIllustration, stripPrintedText, MAX_PROMPT_CHARS } from './hybrid-cover.js'
import { NO_TEXT, textFreeSubject, topicObjects } from './flux-subject.js'

export { NO_TEXT }
export const PAGE_ILLUSTRATION_STYLE = "cute flat-colour children's book illustration, bright colours, clean outlines, white background, vignette composition"
const DEFAULT_SUBJECT = 'cheerful school supplies: pencils, crayons and an apple'
const MAX_SUBJECT_WORDS = 14

// Phrases in a page imagePrompt that introduce what to draw as decoration.
const DECOR_PHRASE = /\b(?:decorated with|decorations? of|decorative|illustrated with|illustrations? of|clip ?art of|pictures? of|images? of|drawings? of|featuring|accented with|with (?:a |an |some )?(?:cute|cartoon|friendly|smiling|happy|playful|small|little)\b)\s*([^.;:!?]+)/i
// Things in a decoration phrase that are layout or printed content, not a subject.
const CUT_AT = /\s+(?:for students|so students|where students|that students|students|around (?:the )?(?:page|questions)|along|at the|in the (?:corner|margin|border)s?|on the (?:side|top|bottom))\b.*$/i
// Words that are about the worksheet or would make FLUX draw text/symbols.
const GENERIC = /\b(?:worksheets?|activit(?:y|ies)|printables?|practice|pages?|sets?|review|bundle|packet|unit|lessons?|grade\s*\w+|kindergarten|k-\d|no[- ]prep|fun|adventures?|exploring|explore|learning|learn|skills?|math|maths|addition|subtraction|multiplication|division|fractions?|numbers?|counting|count|equations?|problems?|word|words|families|family|cvc|phonics|spelling|vocabulary|reading|writing|sentences?|questions?|answers?|quiz|test|fill(?:-|\s)?in|blanks?|missing|complete|match(?:ing)?|write|label(?:ing)?|sort(?:ing)?|build|the|and|of|for|with|about|to|a|an|in|on|my|our|your|&|\+|-|=|equivalen(?:t|ce)|identify(?:ing)?|compar(?:e|ing|isons?)|simplify(?:ing)?|multiple|choice|challenge|models?|visual|strips?|lines?|shade|shading|picture|graphs?|order(?:ing)?|greater|less|than|equal|same|different|mixed|improper|introduction|intro|basics?|warm[- ]?up|assessment|mastery)\b/gi

const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').replace(/\s+/g, ' ').trim()
const capWords = (s, n) => s.split(/\s+/).filter(Boolean).slice(0, n).join(' ')
const topicWords = (s) => clean(String(s ?? '').replace(GENERIC, ' ')).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim()

/**
 * Short concrete subject for a page's spot illustration (≤ 10 words). Order:
 * 0) the hybrid content's own illustrationSubject, when present,
 * 1) the decoration the page imagePrompt asks for ("decorated with acorns and a squirrel"),
 * 2) topic words left in the page + set titles ("autumn leaf"),
 * 3) the set subject, or a generic school scene. Pure — exported for unit testing.
 */
export function pageIllustrationSubject(plan, page) {
  // Hybrid content names its own decorative subject (illustrationSubject).
  // Every source goes through textFreeSubject: FLUX writes on boards, signs, books…
  const own = clean(textFreeSubject(stripPrintedText(page?.content?.illustrationSubject ?? '')))
  if (/[a-z]{3}/i.test(own)) return capWords(own, MAX_SUBJECT_WORDS)
  const m = String(page?.imagePrompt ?? '').match(DECOR_PHRASE)
  if (m) {
    const s = clean(textFreeSubject(stripPrintedText(m[1].replace(CUT_AT, ''))))
    if (/[a-z]{3}/i.test(s)) return capWords(s, MAX_SUBJECT_WORDS)
  }
  const title = page?.content?.title || page?.title || ''
  const words = [...new Set(clean(textFreeSubject(`${topicWords(title)} ${topicWords(plan?.setTitle)}`)).toLowerCase().split(/\s+/).filter(w => w.length > 2))]
  if (words.length) return `${capWords(words.join(' '), 6)} themed objects`
  // Only abstract words ("Equivalent Fraction Matching"): concrete objects for the
  // topic, not "equivalent themed objects" (FLUX drew random animals and an "=").
  const objects = topicObjects(title, plan?.setTitle, plan?.subject)
  if (objects) return objects
  const subj = topicWords(plan?.subject)
  return subj ? `cheerful ${capWords(subj.toLowerCase(), 4)} classroom objects` : DEFAULT_SUBJECT
}

/** Full FLUX prompt for a page spot illustration (style + subject + no-text guard). Pure. */
export function buildPageIllustrationPrompt(subject) {
  const head = `${PAGE_ILLUSTRATION_STYLE}, single isolated subject centred on plain white, no frame, no border, ${NO_TEXT}. `
  const tail = `. ${NO_TEXT}`
  const s = (textFreeSubject(subject) || DEFAULT_SUBJECT).replace(/[.\s]+$/, '').slice(0, MAX_PROMPT_CHARS - head.length - tail.length)
  return `${head}${s}${tail}`
}

export const COLORING_STYLE = "black and white colouring page for children, thick clean black outlines, simple shapes, no shading, no grey, no colour fill, plain white background"

/** FLUX prompt for a full-page colouring (line-art) illustration (activity_art). Pure. */
export function buildColoringPrompt(subject) {
  const head = `${COLORING_STYLE}, single subject filling the frame, no frame, no border, ${NO_TEXT}. `
  const tail = `. ${NO_TEXT}`
  const s = (textFreeSubject(subject) || 'a friendly cartoon animal').replace(/[.\s]+$/, '').slice(0, MAX_PROMPT_CHARS - head.length - tail.length)
  return `${head}${s}${tail}`
}

const promptKey = (p) => String(p).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Per-run illustration source: identical prompts are generated once (the promise
 * is cached, so concurrent pages share one call; a failure is cached too, so a
 * broken prompt costs one call per run), and at most `concurrency` FLUX calls run
 * at once (429/5xx retries happen inside generateIllustration via withRetry).
 * `generate`/`prepare` are injectable for tests.
 *
 * @returns {{ get(prompt: string): Promise<{ href: string, width: number, height: number }>, calls: () => number }}
 */
export function createIllustrationProvider({
  generate = (prompt) => generateIllustration(prompt, { bucket: 'page_illustration' }),
  prepare = prepareIllustration,
  concurrency = 2,
} = {}) {
  const cache = new Map()
  let active = 0
  let calls = 0
  const waiting = []
  const acquire = () => (active < Math.max(1, concurrency) ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r)))
  const release = () => { const next = waiting.shift(); if (next) next(); else active-- }

  async function load(prompt) {
    await acquire()
    try {
      calls++
      const raw = await generate(prompt)
      const ill = await prepare(raw)
      return { href: `data:image/png;base64,${ill.png.toString('base64')}`, width: ill.width, height: ill.height }
    } finally {
      release()
    }
  }

  return {
    get(prompt) {
      const key = promptKey(prompt)
      if (!cache.has(key)) cache.set(key, load(prompt))
      return cache.get(key)
    },
    calls: () => calls,
  }
}
