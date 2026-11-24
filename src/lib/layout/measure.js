// Text measurement for code-rendered pages. librsvg (via sharp) has no measuring
// API, so widths come from a DejaVu Sans advance-width table — the font CI
// (ubuntu-latest) renders with. Every estimate errs wide (bold model, unknown
// glyphs at ≥ 1 em, SAFETY factor), so text measured to fit never overflows when
// the renderer falls back to a narrower font (Helvetica/Arial locally). Pure.

// DejaVu Sans regular advance widths, units per em = 2048, ASCII 32–126.
const ASCII = [
  651, 821, 942, 1716, 1303, 1946, 1597, 563, 799, 799, 1024, 1716, 651, 739, 651, 690, // ' '…'/'
  1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, 1303, // 0-9
  690, 690, 1716, 1716, 1716, 1087, 2048, // : ; < = > ? @
  1401, 1405, 1430, 1577, 1294, 1178, 1587, 1540, 604, 604, 1343, 1141, 1767, 1532, 1612, 1235, 1612, 1423, 1300, 1251, 1499, 1401, 2025, 1403, 1251, 1403, // A-Z
  799, 690, 799, 1716, 1024, 1024, // [ \ ] ^ _ `
  1255, 1300, 1126, 1300, 1260, 721, 1300, 1298, 569, 569, 1186, 569, 1995, 1298, 1253, 1300, 1300, 842, 1067, 803, 1298, 1212, 1675, 1212, 1212, 1075, // a-z
  1303, 690, 1303, 1716, // { | } ~
]
const EXTRA = {
  '‘': 651, '’': 651, '“': 1060, '”': 1060, '–': 1024, '—': 2048,
  '•': 1208, '…': 2048, ' ': 651, '×': 1716, '÷': 1716, '°': 1024,
  '‑': 739, '‐': 739, '−': 1716,
}
const UNITS = 2048
const UNKNOWN_EM = 1.0 // other BMP scripts (Thai, CJK, symbols): wide guess
const ASTRAL_EM = 1.3 // emoji and other astral-plane glyphs
// DejaVu Sans Bold ≈ regular × 1.08 + 0.055 em (narrow glyphs like i/l/t grow the most).
const BOLD_MUL = 1.08
const BOLD_ADD = 0.055
export const SAFETY = 1.04

/** Advance width of one code point in em (regular weight). */
function regularEm(ch) {
  const cp = ch.codePointAt(0)
  if (cp >= 32 && cp <= 126) return ASCII[cp - 32] / UNITS
  if (EXTRA[ch]) return EXTRA[ch] / UNITS
  if (cp < 32) return 0
  if (cp > 0xffff) return ASTRAL_EM
  // Accented Latin: measure the base letter (é → e), keeping the wide default otherwise.
  const base = ch.normalize('NFD')[0]
  if (base !== ch && base.codePointAt(0) >= 32 && base.codePointAt(0) <= 126) return ASCII[base.codePointAt(0) - 32] / UNITS
  if (cp >= 0x300 && cp <= 0x36f) return 0 // combining marks
  return UNKNOWN_EM
}

/** Width in px of `str` at `size` px. Pure. */
export function measureText(str, size, { bold = false } = {}) {
  let em = 0
  for (const ch of String(str ?? '')) {
    const r = regularEm(ch)
    em += bold && r > 0 ? r * BOLD_MUL + BOLD_ADD : r
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
function hardSplit(word, maxWidth, size, bold) {
  const parts = []
  let cur = ''
  for (const ch of word) {
    if (cur && measureText(cur + ch, size, { bold }) > maxWidth) { parts.push(cur); cur = ch } else cur += ch
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
export function wrapTokens(tokens, maxWidth, size, { bold = false } = {}) {
  const space = measureText(' ', size, { bold })
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
    const w = measureText(t, size, { bold })
    if (w <= maxWidth) { push({ text: t }, w); continue }
    for (const piece of hardSplit(t, maxWidth, size, bold)) push({ text: piece }, measureText(piece, size, { bold }))
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
export function wrapText(str, maxWidth, size, { bold = false } = {}) {
  const words = glueMath(cleanText(str).split(/\s+/).filter(Boolean))
  const lines = wrapTokens(words, maxWidth, size, { bold }).map(l => l.map(t => t.text).join(' '))
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
export function fitText(str, { width, maxLines = Infinity, max, min, step = 1, bold = false }) {
  for (let size = max; size >= min; size -= step) {
    const lines = wrapText(str, width, size, { bold })
    if (lines.length <= maxLines) return { size, lines }
  }
  throw new LayoutOverflowError(`text does not fit ${maxLines} line(s) of ${width}px at ${min}px: "${String(str).slice(0, 40)}…"`)
}

/**
 * Single-line fit that never throws: shrinks to `min`, then truncates with "…".
 * Only for decorative/header text (never for questions or answers). Pure.
 */
export function fitLine(str, { width, max, min, bold = false }) {
  const s = cleanText(str).trim()
  for (let size = max; size >= min; size--) if (measureText(s, size, { bold }) <= width) return { size, text: s }
  let cut = s
  while (cut && measureText(`${cut}…`, min, { bold }) > width) cut = [...cut].slice(0, -1).join('')
  return { size: min, text: `${cut.trimEnd()}…` }
}
