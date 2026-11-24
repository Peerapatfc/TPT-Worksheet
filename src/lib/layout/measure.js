// Text measurement for code-rendered pages. librsvg (via sharp) has no measuring
// API, so widths come from the advance widths of the bundled Nunito TTFs
// (src/lib/fonts.js) — the exact font every page is rendered with, on CI and
// locally. Glyphs Nunito lacks (Thai, emoji, …) are drawn by a system fallback
// font and measured with a wide guess (≥ 1 em). Kerning is ignored (it only
// narrows Nunito text), plus a small SAFETY margin. Pure apart from reading the
// font files once.
import { fontMetrics } from '../fonts.js'

const UNKNOWN_EM = 1.0 // other BMP scripts (Thai, CJK, symbols) from a fallback font: wide guess
const ASTRAL_EM = 1.3 // emoji and other astral-plane glyphs
export const SAFETY = 1.02

/** Advance width of one code point in em for a parsed font. */
function charEm(font, ch) {
  const cp = ch.codePointAt(0)
  if (cp < 32) return 0
  const adv = font.advance(cp)
  if (adv !== undefined) return adv / font.unitsPerEm
  if (cp >= 0x300 && cp <= 0x36f) return 0 // combining marks
  // Accented Latin the font lacks: measure the base letter (é → e) if it has it.
  const base = ch.normalize('NFD')[0]
  const baseAdv = base !== ch ? font.advance(base.codePointAt(0)) : undefined
  if (baseAdv !== undefined) return baseAdv / font.unitsPerEm
  return cp > 0xffff ? ASTRAL_EM : UNKNOWN_EM
}

// Width in em per (font, string): layouts re-measure the same words at every size they try.
const emCache = new Map()

/** Width in px of `str` at `size` px in the bundled font. Pure. */
export function measureText(str, size, { bold = false, italic = false } = {}) {
  const key = `${bold ? 'b' : italic ? 'i' : 'r'}${String(str ?? '')}`
  let em = emCache.get(key)
  if (em === undefined) {
    const m = fontMetrics()
    const font = bold ? m.bold : italic ? m.italic : m.regular
    em = 0
    for (const ch of String(str ?? '')) em += charEm(font, ch)
    if (emCache.size > 50000) emCache.clear()
    emCache.set(key, em)
  }
  return em * size * SAFETY
}

/** Strip characters that are not allowed in XML 1.0 (control chars, lone surrogates). Pure. */
export const cleanText = (s) => String(s ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/[\t\r\n]+/g, ' ')

/** Split a word wider than maxWidth into pieces that each fit (at least one char per piece). */
function hardSplit(word, maxWidth, size, f) {
  const parts = []
  let cur = ''
  for (const ch of word) {
    if (cur && measureText(cur + ch, size, f) > maxWidth) { parts.push(cur); cur = ch } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

/**
 * Greedy wrap of a token list. Tokens are strings (words) or `{ blank: width }`
 * (an inline answer blank of fixed px width). Returns lines of placed tokens
 * `{ text?, blank?, x, w }` with each line's total width ≤ maxWidth, except a
 * single blank wider than the line (never produced by callers). Pure.
 */
export function wrapTokens(tokens, maxWidth, size, { bold = false, italic = false } = {}) {
  const f = { bold, italic }
  const space = measureText(' ', size, f)
  const lines = []
  let line = []
  let x = 0
  const push = (tok, w) => {
    if (line.length && x + space + w > maxWidth) { lines.push(line); line = []; x = 0 }
    const at = line.length ? x + space : 0
    line.push({ ...tok, x: at, w })
    x = at + w
  }
  for (const t of tokens) {
    if (typeof t === 'object' && t.blank) { push({ blank: true }, t.blank); continue }
    const w = measureText(t, size, f)
    if (w <= maxWidth) { push({ text: t }, w); continue }
    for (const piece of hardSplit(t, maxWidth, size, f)) push({ text: piece }, measureText(piece, size, f))
  }
  if (line.length) lines.push(line)
  return lines
}

const OPERATOR = /^[+\-−×÷=<>≤≥*/]$/
export const NBSP = ' '

/**
 * Keep short math expressions on one line: an operator token is glued (with a
 * no-break space) to its neighbours, and a trailing "?" to the expression, so
 * "7 + 5 = ?" never wraps as "7 / + 5 = ?". Glued tokens wider than a line are
 * still hard-split by wrapTokens. Pure.
 */
export function glueMath(words) {
  const out = []
  let glueNext = false
  for (const w of words) {
    if (out.length && (OPERATOR.test(w) || (w === '?' && /\d|[=?]$/.test(out[out.length - 1])))) {
      out[out.length - 1] += NBSP + w
      glueNext = OPERATOR.test(w)
    } else if (glueNext) {
      out[out.length - 1] += NBSP + w
      glueNext = false
    } else out.push(w)
  }
  return out
}

/** Word-wrap plain text into lines (strings) that each measure ≤ maxWidth. Pure. */
export function wrapText(str, maxWidth, size, { bold = false, italic = false } = {}) {
  const words = glueMath(cleanText(str).split(/\s+/).filter(Boolean))
  const lines = wrapTokens(words, maxWidth, size, { bold, italic }).map(l => l.map(t => t.text).join(' '))
  return lines.length ? lines : ['']
}

/** Thrown when text cannot fit its box even at the minimum font size. */
export class LayoutOverflowError extends Error {
  constructor(message) { super(message); this.name = 'LayoutOverflowError' }
}

/**
 * Largest size (max → min, step) at which `str` wraps into ≤ maxLines lines of
 * ≤ width px. Throws LayoutOverflowError if it cannot fit at `min`. Pure.
 * @returns {{ size: number, lines: string[] }}
 */
export function fitText(str, { width, maxLines = Infinity, max, min, step = 1, bold = false, italic = false }) {
  for (let size = max; size >= min; size -= step) {
    const lines = wrapText(str, width, size, { bold, italic })
    if (lines.length <= maxLines) return { size, lines }
  }
  throw new LayoutOverflowError(`text does not fit ${maxLines} line(s) of ${width}px at ${min}px: "${String(str).slice(0, 40)}…"`)
}

/**
 * Single-line fit that never throws: shrinks to `min`, then truncates with "…".
 * Only for decorative/header text (never for questions or answers). Pure.
 */
export function fitLine(str, { width, max, min, bold = false, italic = false }) {
  const s = cleanText(str).trim()
  for (let size = max; size >= min; size--) if (measureText(s, size, { bold, italic }) <= width) return { size, text: s }
  let cut = s
  while (cut && measureText(`${cut}…`, min, { bold, italic }) > width) cut = [...cut].slice(0, -1).join('')
  return { size: min, text: `${cut.trimEnd()}…` }
}
