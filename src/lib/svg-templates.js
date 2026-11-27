// Deterministic SVG templates for pages that are pure text — answer keys and the
// text-only marketing slides. Rendering these locally (sharp → PNG) instead of
// with gpt-image-2 removes their image + vision-QA cost and guarantees the
// printed answers match the Q&A data exactly.
import sharp from 'sharp'
import { resolveSourceQuestions } from './source-pages.js'
import { FONT_STACK } from './fonts.js' // also points fontconfig at the bundled font before any render

export const FONT = FONT_STACK
const DEFAULT_COLOR = '#1B4F8A'
const GRAY = '#555555'

export const PAGE_W = 1024
export const PAGE_H = 1536
const SLIDE = 1024

export const safeColor = (hex) => (/^#[0-9A-Fa-f]{6}$/.test(hex ?? '') ? hex : DEFAULT_COLOR)

export const escapeXml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

/**
 * Greedy word wrap using a conservative average-glyph-width estimate (wider than
 * Nunito, so lines never overflow; hybrid layouts use exact widths, layout/measure.js).
 * Words longer than a line are hard-split.
 */
export function wrapText(text, maxWidth, fontSize, bold = false) {
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * (bold ? 0.62 : 0.56))))
  const lines = []
  let line = ''
  for (let word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    while (word.length > maxChars) {
      if (line) { lines.push(line); line = '' }
      lines.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export const text = (x, y, content, { size, weight = 'normal', fill = '#000', anchor = 'start', style = 'normal' }) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" font-style="${style}" fill="${fill}" text-anchor="${anchor}">${escapeXml(content)}</text>`

const checkmark = (cx, cy, r, color) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
  `<path d="M ${cx - r * 0.45} ${cy + r * 0.02} L ${cx - r * 0.12} ${cy + r * 0.35} L ${cx + r * 0.5} ${cy - r * 0.32}" stroke="#fff" stroke-width="${r * 0.28}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`

/** Answer-key sections: one per source page (keeps the worksheet's own question numbers). */
function answerSections(plan, page) {
  const allPages = plan.pages ?? []
  const nums = page.sourcePageNums ?? (page.sourcePageNum ? [page.sourcePageNum] : [])
  const sections = nums
    .map(n => allPages.find(p => p.pageNum === n))
    .filter(p => p?.content?.questions?.length)
    .map(p => ({ heading: `Page ${p.pageNum}`, questions: p.content.questions }))
  if (sections.length) return sections
  // Same fallback as the image path: every question in the set.
  return [{ heading: null, questions: resolveSourceQuestions(page, allPages).questions }]
}

function layoutAnswers(sections, scale, width) {
  const ansSize = 30 * scale
  const qSize = 21 * scale
  const headSize = 32 * scale
  const indent = 64 * scale
  const out = []
  let y = 0
  for (const section of sections) {
    if (section.heading) {
      y += headSize * 1.4
      out.push({ kind: 'heading', y, text: section.heading, size: headSize })
      y += headSize * 0.5
    }
    for (const q of section.questions) {
      const ansLines = wrapText(q.answer, width - indent, ansSize, true)
      const qLines = wrapText(q.question, width - indent, qSize).slice(0, 2)
      y += ansSize * 1.25
      out.push({ kind: 'num', y, text: `${q.num}.`, size: ansSize })
      ansLines.forEach((l, i) => out.push({ kind: 'answer', y: y + i * ansSize * 1.2, text: l, size: ansSize, indent }))
      y += (ansLines.length - 1) * ansSize * 1.2
      qLines.forEach(l => { y += qSize * 1.25; out.push({ kind: 'question', y, text: l, size: qSize, indent }) })
      y += ansSize * 0.35
    }
  }
  return { items: out, height: y }
}

/** Build the answer-key page SVG (1024×1536, same frame/header style as AI pages). Pure. */
export function answerKeySvg(plan, page) {
  const color = safeColor(plan.themeColor)
  const nums = page.sourcePageNums ?? (page.sourcePageNum ? [page.sourcePageNum] : [])
  const label = nums.length ? `Answer Key (Pages ${nums.join(' & ')})` : 'Answer Key'
  const sections = answerSections(plan, page)

  const left = 80
  const width = PAGE_W - left * 2
  const top = 290
  const available = PAGE_H - top - 70

  // Shrink until everything fits on the page.
  let scale = 1
  let layout = layoutAnswers(sections, scale, width)
  while (layout.height > available && scale > 0.4) {
    scale -= 0.05
    layout = layoutAnswers(sections, scale, width)
  }

  const body = layout.items.map(it => {
    const y = top + it.y
    if (it.kind === 'heading') return text(left, y, it.text, { size: it.size, weight: 'bold', fill: color }) +
      `<line x1="${left}" y1="${y + it.size * 0.3}" x2="${left + width}" y2="${y + it.size * 0.3}" stroke="${color}" stroke-width="2"/>`
    if (it.kind === 'num') return text(left, y, it.text, { size: it.size, weight: 'bold', fill: color })
    if (it.kind === 'answer') return text(left + it.indent, y, it.text, { size: it.size, weight: 'bold' })
    return text(left + it.indent, y, it.text, { size: it.size, fill: GRAY, style: 'italic' })
  }).join('')

  return pageSvg(plan, label, `${text(PAGE_W / 2, 230, 'Answer Key', { size: 60, weight: 'bold', fill: color, anchor: 'middle' })}
${body}`)
}

/**
 * Full portrait page: white background, theme-color border and header bar with
 * the set title and "{grade} | {label}" — the frame every template page shares.
 */
export function pageSvg(plan, label, body) {
  const color = safeColor(plan.themeColor)
  const title = wrapText(plan.setTitle, PAGE_W - 120, 34, true)[0]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
<rect width="100%" height="100%" fill="#fff"/>
<rect x="14" y="14" width="${PAGE_W - 28}" height="${PAGE_H - 28}" fill="none" stroke="${color}" stroke-width="14"/>
<rect x="21" y="21" width="${PAGE_W - 42}" height="118" fill="${color}"/>
${text(PAGE_W / 2, 72, title, { size: 34, weight: 'bold', fill: '#fff', anchor: 'middle' })}
${text(PAGE_W / 2, 116, `${plan.gradeLevel ?? ''} | ${label}`, { size: 24, weight: 'bold', fill: '#fff', anchor: 'middle' })}
${body}
</svg>`
}

// Conservative average bold glyph width in em (Nunito Bold averages ≈ 0.5 em), so
// text sized with it always fits. Hybrid layouts measure exactly (layout/measure.js).
const BOLD_EM = 0.66

/**
 * Largest font size (≤ base, ≥ min) at which the longest line still fits maxWidth.
 * Pure — exported for unit testing.
 */
export function fitFontSize(lines, maxWidth, base, min = 24) {
  const longest = Math.max(1, ...lines.map(l => String(l).length))
  return Math.max(min, Math.min(base, Math.floor(maxWidth / (longest * BOLD_EM))))
}

/** "What's Included" marketing slide SVG (1024×1024). Pure. */
export function whatsIncludedSvg({ color, worksheetCount, answerKeyCount, pageCount, totalQuestions }) {
  const c = safeColor(color)
  const items = [
    `${worksheetCount} No-Prep Worksheet & Activity Pages`,
    `${answerKeyCount} Answer Key Page${answerKeyCount === 1 ? '' : 's'}`,
    `${pageCount} Total Pages`,
    ...(totalQuestions > 0 ? [`${totalQuestions}+ Practice Questions`] : []),
    'PDF Format — Print & Go',
    'Answer Key Included for All Pages',
  ]
  const gap = 118
  const startY = 320 + (6 - items.length) * gap / 2
  const textX = 190
  const size = fitFontSize(items, SLIDE - textX - 50, 38)
  const rows = items.map((item, i) => {
    const y = startY + i * gap
    return checkmark(130, y - 12, 30, c) + text(textX, y, item, { size, weight: 'bold', fill: '#222' })
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE}" height="${SLIDE}" viewBox="0 0 ${SLIDE} ${SLIDE}">
<rect width="100%" height="100%" fill="#fff"/>
<rect width="${SLIDE}" height="180" fill="${c}"/>
${text(SLIDE / 2, 118, "WHAT'S INCLUDED", { size: 72, weight: 'bold', fill: '#fff', anchor: 'middle' })}
${rows}
<rect x="0" y="${SLIDE - 24}" width="${SLIDE}" height="24" fill="${c}"/>
</svg>`
}

/** "No Prep • Print & Go" benefits slide SVG (1024×1024). Pure. */
export function benefitsSvg({ color, badge }) {
  const c = safeColor(color)
  const uses = ['Whole Class', 'Small Groups', 'Homework', 'Morning Work', 'Sub Plans', 'Intervention']
  const cards = uses.map((u, i) => {
    const x = 92 + (i % 2) * 430
    const y = 360 + Math.floor(i / 2) * 150
    return `<rect x="${x}" y="${y}" width="410" height="120" rx="24" fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="4"/>` +
      checkmark(x + 58, y + 60, 24, c) + text(x + 100, y + 73, u, { size: 36, weight: 'bold', fill: '#222' })
  }).join('')
  const badgeSvg = badge ? text(SLIDE / 2, SLIDE - 58, badge, { size: 40, weight: 'bold', fill: '#fff', anchor: 'middle' }) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE}" height="${SLIDE}" viewBox="0 0 ${SLIDE} ${SLIDE}">
<rect width="100%" height="100%" fill="#fff"/>
${text(SLIDE / 2, 170, 'NO PREP • PRINT & GO', { size: 76, weight: 'bold', fill: c, anchor: 'middle' })}
${text(SLIDE / 2, 290, 'Perfect for:', { size: 48, weight: 'bold', fill: '#333', anchor: 'middle' })}
${cards}
<rect x="0" y="${SLIDE - 130}" width="${SLIDE}" height="130" fill="${c}"/>
${badgeSvg}
</svg>`
}

/** Blend a #RRGGBB color toward white by `t` (0 = color, 1 = white). Pure. */
export function tint(hex, t) {
  const c = safeColor(hex)
  const ch = (i) => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`
}

// Wider than wrapText's estimate: cover titles are large and bold, so leave margin.
const TITLE_EM = 0.7
const COVER_MARGIN = 90

/**
 * Wrap the cover title at the largest size (step 4, 96 → 44) that fits in 3 lines;
 * at the minimum size it may use more lines. Words longer than a line are
 * hard-split, so a line never exceeds maxWidth. Pure — exported for unit testing.
 */
export function fitCoverTitle(title, maxWidth, { max = 96, min = 44, maxLines = 3 } = {}) {
  let size = max
  let lines
  for (; size >= min; size -= 4) {
    lines = wrapText(title, maxWidth, size * TITLE_EM / 0.62, true)
    if (lines.length <= maxLines) return { size, lines }
  }
  size = min
  return { size, lines: wrapText(title, maxWidth, size * TITLE_EM / 0.62, true) }
}

const sparkle = (x, y, r, fill) =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`

const cornerDots = (color, accent, W = PAGE_W, H = PAGE_H) => {
  const one = `${sparkle(78, 92, 26, color)}${sparkle(130, 66, 13, accent)}${`<circle cx="66" cy="150" r="9" fill="${accent}"/>`}${`<circle cx="150" cy="118" r="6" fill="${color}" opacity=".6"/>`}`
  return [
    `<g>${one}</g>`,
    `<g transform="translate(${W} 0) scale(-1 1)">${one}</g>`,
    `<g transform="translate(0 ${H}) scale(1 -1)">${one}</g>`,
    `<g transform="translate(${W} ${H}) scale(-1 -1)">${one}</g>`,
  ].join('')
}

/**
 * Art for a cover slot: the illustration aspect-fit and centred on a soft disc; else
 * `decor(slot)` (code-drawn motifs); else just the soft disc. Pure.
 */
function artInSlot(slot, illustration, soft, decor) {
  const cx = slot.x + slot.w / 2
  if (illustration?.href && illustration.width > 0 && illustration.height > 0) {
    const scale = Math.min(slot.w / illustration.width, slot.h / illustration.height)
    const w = Math.round(illustration.width * scale)
    const h = Math.round(illustration.height * scale)
    const ix = Math.round(cx - w / 2)
    const iy = Math.round(slot.y + (slot.h - h) / 2)
    return `<ellipse cx="${cx}" cy="${iy + h / 2}" rx="${w / 2 + 24}" ry="${h / 2}" fill="${soft}" opacity=".55"/>` +
      `<image x="${ix}" y="${iy}" width="${w}" height="${h}" href="${escapeXml(illustration.href)}"/>`
  }
  if (decor) return decor(slot)
  return `<ellipse cx="${cx}" cy="${slot.y + slot.h / 2}" rx="${slot.w / 2 + 20}" ry="${slot.h / 2}" fill="${soft}" opacity=".55"/>`
}

/**
 * Square marketing cover (1024×1024) drawn by code — the zero-OpenAI replacement for
 * the gpt-image-2 marketing cover: title, "grade | subject" line, the cover
 * illustration (or `decor(slot)` motifs) and a theme-colour banner
 * "No Prep Printable • Answer Key Included". All text is XML-escaped. Pure.
 *
 * @param {{ title: string, subtitle?: string, color?: string,
 *   illustration?: { href: string, width: number, height: number } | null,
 *   decor?: ((slot: { x: number, y: number, w: number, h: number }) => string) | null,
 *   banner?: string }} opts
 */
export function marketingCoverSvg({ title, subtitle, color, illustration = null, decor = null, banner = 'No Prep Printable • Answer Key Included' }) {
  const c = safeColor(color)
  const bg = tint(c, 0.92)
  const soft = tint(c, 0.8)
  const accent = tint(c, 0.45)
  const margin = 80
  const innerW = SLIDE - margin * 2
  const bannerH = 130
  const bannerY = SLIDE - 16 - bannerH

  const { size, lines } = fitCoverTitle(title, innerW, { max: 80, min: 40, maxLines: 2 })
  const lineH = size * 1.1
  const firstBase = 64 + size
  const titleSvg = lines.map((l, i) => text(SLIDE / 2, firstBase + i * lineH, l, { size, weight: 'bold', fill: c, anchor: 'middle' })).join('')
  let y = firstBase + (lines.length - 1) * lineH
  let subSvg = ''
  if (subtitle) {
    const subSize = fitFontSize([subtitle], innerW, 34, 22)
    y += 54
    subSvg = text(SLIDE / 2, y, wrapText(subtitle, innerW, subSize)[0], { size: subSize, fill: '#555', anchor: 'middle', style: 'italic' })
  }
  const slot = { x: margin, y: y + 30, w: innerW, h: Math.max(160, bannerY - 26 - (y + 30)) }
  const art = artInSlot(slot, illustration, soft, decor)
  const bannerSize = fitFontSize([banner], SLIDE - 120, 40, 24)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE}" height="${SLIDE}" viewBox="0 0 ${SLIDE} ${SLIDE}">
<rect width="100%" height="100%" fill="${bg}"/>
<rect x="16" y="16" width="${SLIDE - 32}" height="${SLIDE - 32}" rx="34" fill="#fff" stroke="${c}" stroke-width="12"/>
<rect x="30" y="30" width="${SLIDE - 60}" height="${SLIDE - 60}" rx="24" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="3 12" stroke-linecap="round"/>
${cornerDots(c, accent, SLIDE, SLIDE)}
${art}
${titleSvg}
${subSvg}
<path d="M16 ${bannerY} H${SLIDE - 16} V${SLIDE - 50} Q${SLIDE - 16} ${SLIDE - 16} ${SLIDE - 50} ${SLIDE - 16} H50 Q16 ${SLIDE - 16} 16 ${SLIDE - 50} Z" fill="${c}"/>
${text(SLIDE / 2, bannerY + bannerH / 2 + bannerSize * 0.36, banner, { size: bannerSize, weight: 'bold', fill: '#fff', anchor: 'middle' })}
</svg>`
}

/**
 * Hybrid cover page (1024×1536): code-drawn frame, title, subtitle, name line and
 * grade/page-count pill around an AI illustration (`illustration.href` is a PNG data
 * URI with transparent background; it is aspect-fit into the free area). Without an
 * illustration the slot is left as a soft tinted panel, or filled by `decor(slot)`
 * (code-drawn motifs for the zero-OpenAI text-only cover). All text is XML-escaped. Pure.
 *
 * @param {{ title: string, subtitle?: string, gradeLabel?: string, pageCount?: number,
 *   color?: string, illustration?: { href: string, width: number, height: number } | null,
 *   decor?: ((slot: { x: number, y: number, w: number, h: number }) => string) | null }} opts
 */
export function hybridCoverSvg({ title, subtitle, gradeLabel, pageCount, color, illustration = null, decor = null }) {
  const c = safeColor(color)
  const bg = tint(c, 0.92)
  const soft = tint(c, 0.8)
  const accent = tint(c, 0.45)
  const innerW = PAGE_W - COVER_MARGIN * 2

  const { size, lines } = fitCoverTitle(title, innerW)
  const lineH = size * 1.12
  const firstBase = 120 + size
  const titleSvg = lines.map((l, i) => text(PAGE_W / 2, firstBase + i * lineH, l, { size, weight: 'bold', fill: c, anchor: 'middle' })).join('')
  let y = firstBase + (lines.length - 1) * lineH

  let subSvg = ''
  if (subtitle) {
    const subSize = fitFontSize([subtitle], innerW, 36, 24)
    const subLines = wrapText(subtitle, innerW, subSize).slice(0, 2)
    subSvg = subLines.map((l, i) => text(PAGE_W / 2, y + 66 + i * subSize * 1.25, l, { size: subSize, fill: '#555', anchor: 'middle', style: 'italic' })).join('')
    y += 66 + (subLines.length - 1) * subSize * 1.25
  }

  const pillY = PAGE_H - 210
  const nameY = pillY - 46
  const slot = { x: COVER_MARGIN, y: y + 44, w: innerW, h: Math.max(200, nameY - 60 - (y + 44)) }

  const art = artInSlot(slot, illustration, soft, decor)

  const pillText = [gradeLabel, pageCount ? `${pageCount} Printable Pages` : null].filter(Boolean).join(' | ')
  const pillSize = fitFontSize([pillText], 560, 36, 22)
  const pill = pillText
    ? `<rect x="${PAGE_W / 2 - 320}" y="${pillY}" width="640" height="90" rx="45" fill="${c}"/>` +
      text(PAGE_W / 2, pillY + 45 + pillSize * 0.36, pillText, { size: pillSize, weight: 'bold', fill: '#fff', anchor: 'middle' })
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
<rect width="100%" height="100%" fill="${bg}"/>
<rect x="16" y="16" width="${PAGE_W - 32}" height="${PAGE_H - 32}" rx="34" fill="#fff" stroke="${c}" stroke-width="12"/>
<rect x="30" y="30" width="${PAGE_W - 60}" height="${PAGE_H - 60}" rx="24" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="3 12" stroke-linecap="round"/>
${cornerDots(c, accent)}
${art}
${titleSvg}
${subSvg}
${text(PAGE_W / 2, nameY, 'Name: ______________________________', { size: 28, fill: '#444', anchor: 'middle' })}
${pill}
</svg>`
}

/** Rasterize an SVG string to a PNG buffer. */
export const renderSvg = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
