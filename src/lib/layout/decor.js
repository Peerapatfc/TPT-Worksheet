// Code-drawn decoration for hybrid pages: theme motifs (corner clusters and the
// text-only fallback block), number badges, answer boxes/lines, word-bank pills.
// Everything is a pure SVG string; text is XML-escaped by the caller via `textEl`.
import { escapeXml, safeColor, tint } from '../svg-templates.js'
import { cleanText } from './measure.js'
import { FONT_STACK } from '../fonts.js'

export const FONT = FONT_STACK

/** <text> element with escaped, XML-safe content. */
export const textEl = (x, y, content, { size, weight = 'normal', fill = '#222', anchor = 'start', style = 'normal' }) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-family="${FONT}" font-size="${r1(size)}" font-weight="${weight}" font-style="${style}" fill="${fill}" text-anchor="${anchor}">${escapeXml(cleanText(content))}</text>`

export const r1 = (n) => Math.round(n * 10) / 10

// ── Motifs: drawn in a 100×100 box centred on (0,0), then translated/scaled ────
const MOTIFS = {
  leaf: (a, b) => `<path d="M0 -46 C30 -30 40 6 0 46 C-40 6 -30 -30 0 -46 Z" fill="${a}"/><path d="M0 -38 L0 50 M0 -8 L16 -20 M0 8 L-16 -4 M0 22 L14 12" stroke="${b}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  star: (a) => `<path d="M0 -46 L13 -15 L46 -14 L20 7 L29 40 L0 21 L-29 40 L-20 7 L-46 -14 L-13 -15 Z" fill="${a}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`,
  snowflake: (a) => `<g stroke="${a}" stroke-width="7" stroke-linecap="round">${[0, 60, 120].map(d => `<path transform="rotate(${d})" d="M0 -44 L0 44 M0 -28 L-12 -40 M0 -28 L12 -40 M0 28 L-12 40 M0 28 L12 40"/>`).join('')}</g>`,
  flower: (a, b) => `${[0, 72, 144, 216, 288].map(d => `<ellipse transform="rotate(${d}) translate(0 -24)" rx="16" ry="22" fill="${a}"/>`).join('')}<circle r="14" fill="${b}"/>`,
  apple: (a, b) => `<path d="M0 -24 C-26 -40 -48 -18 -42 10 C-36 38 -14 48 0 40 C14 48 36 38 42 10 C48 -18 26 -40 0 -24 Z" fill="${a}"/><path d="M0 -24 L4 -44" stroke="#6b4423" stroke-width="6" stroke-linecap="round"/><path d="M6 -38 C20 -52 34 -46 36 -40 C24 -32 12 -32 6 -38 Z" fill="${b}"/>`,
  sparkle: (a) => `<path d="M0 -46 Q8 -8 46 0 Q8 8 0 46 Q-8 8 -46 0 Q-8 -8 0 -46 Z" fill="${a}"/>`,
  dot: (a) => `<circle r="22" fill="${a}"/>`,
}

const THEMES = [
  [/\b(autumn|fall|leaf|leaves|tree|trees|forest|plant|plants|harvest|pumpkin|thanksgiving)\b/i, 'leaf'],
  [/\b(space|planet|planets|solar|star|stars|moon|night|galaxy|astronaut|rocket)\b/i, 'star'],
  [/\b(winter|snow|snowman|snowflakes?|ice|christmas|holiday|december|january)\b/i, 'snowflake'],
  [/\b(spring|flower|flowers|garden|bloom|bees?|butterfly|butterflies|easter|mother'?s day)\b/i, 'flower'],
  [/\b(apple|apples|school|back to school|teacher)\b/i, 'apple'],
]

/** Motif name for a plan, from its title/subject keywords; 'sparkle' otherwise. Pure. */
export function themeMotif(plan) {
  const s = `${plan?.setTitle ?? ''} ${plan?.subject ?? ''}`
  return THEMES.find(([re]) => re.test(s))?.[1] ?? 'sparkle'
}

/** Palette derived from the theme colour (main, light accent, warm accent). */
export function palette(color) {
  const c = safeColor(color)
  return { c, accent: tint(c, 0.45), soft: tint(c, 0.82), pale: tint(c, 0.93), warm: '#F4B400', green: '#7CB342', red: '#E4572E' }
}

/** One motif centred at (x, y), `size` px across. */
export function motif(name, x, y, size, fillA, fillB = '#ffffff', rotate = 0) {
  const draw = MOTIFS[name] ?? MOTIFS.sparkle
  return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${rotate}) scale(${(size / 100).toFixed(3)})">${draw(fillA, fillB)}</g>`
}

/** Cluster of 3 motifs filling a w×h box at (x, y). */
export function motifCluster(name, x, y, w, h, pal, mirror = false) {
  const s = Math.min(w, h)
  const colors = [[pal.c, pal.pale], [pal.warm, '#fff3c4'], [pal.red, '#ffd9cc']]
  const leafColors = [[pal.red, '#8a2b0e'], [pal.warm, '#8a5a00'], [pal.green, '#2e5c12']]
  const cs = name === 'leaf' ? leafColors : colors
  const spots = [[0.38, 0.4, 0.62, -20], [0.78, 0.22, 0.34, 25], [0.75, 0.78, 0.3, 50]]
  return spots.map(([fx, fy, fs, rot], i) => {
    const px = mirror ? x + w - fx * w : x + fx * w
    return motif(name, px, y + fy * h, s * fs, cs[i][0], cs[i][1], mirror ? -rot : rot)
  }).join('')
}

/**
 * Decorative block used in the illustration slot when FLUX failed: a soft tinted
 * disc with a few theme motifs. Fills the w×h box at (x, y).
 */
export function motifBlock(name, x, y, w, h, pal) {
  const s = Math.min(w, h)
  const cx = x + w / 2
  const cy = y + h / 2
  const leafColors = [pal.red, pal.warm, pal.green, pal.c]
  const cols = name === 'leaf' ? leafColors : [pal.c, pal.warm, pal.red, pal.accent]
  const pts = [[0, -0.18, 0.36, 0], [-0.24, 0.14, 0.26, -30], [0.24, 0.14, 0.26, 30], [0, 0.3, 0.14, 0]]
  return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(w / 2)}" ry="${r1(h / 2)}" fill="${pal.pale}"/>` +
    pts.map(([dx, dy, fs, rot], i) => motif(name, cx + dx * s, cy + dy * s, s * fs, cols[i], '#ffffff', rot)).join('')
}

/** Filled number badge (circle) with the number centred. */
export function numberBadge(cx, cy, r, num, color) {
  const label = String(num)
  const size = r * (label.length > 2 ? 0.8 : label.length > 1 ? 1.0 : 1.15)
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${color}"/>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r - 4)}" fill="none" stroke="#fff" stroke-width="2" opacity=".55"/>` +
    textEl(cx, cy + size * 0.36, label, { size, weight: 'bold', fill: '#fff', anchor: 'middle' })
}

/** Rounded answer box. */
export const answerBox = (x, y, w, h, color) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(Math.min(18, h / 3))}" fill="#fff" stroke="${color}" stroke-width="4"/>`

/** Writing line. */
export const answerLine = (x1, x2, y, color = '#9a9a9a') =>
  `<line x1="${r1(x1)}" y1="${r1(y)}" x2="${r1(x2)}" y2="${r1(y)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`

/** Embed a prepared illustration (data-URI PNG) aspect-fit into a box, over a soft vignette. */
export function illustrationEl(ill, box, pal, { vignette = true } = {}) {
  const scale = Math.min(box.w / ill.width, box.h / ill.height)
  const w = ill.width * scale
  const h = ill.height * scale
  const x = box.x + (box.w - w) / 2
  const y = box.y + (box.h - h) / 2
  return {
    rect: { x, y, w, h },
    svg: (vignette ? `<ellipse cx="${r1(x + w / 2)}" cy="${r1(y + h * 0.55)}" rx="${r1(w * 0.5)}" ry="${r1(h * 0.45)}" fill="${pal.pale}"/>` : '') +
      `<image x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" href="${escapeXml(ill.href)}"/>`,
  }
}
