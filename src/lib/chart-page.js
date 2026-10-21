// Code-drawn chart pages (picture graph, bar graph, data table) + their questions.
// gpt-image-2 does not draw icon counts or bar heights reliably, and the vision
// QA/reconcile models can't count them either (they echo the spec), so pages
// whose questions read chart data are rendered from structured data instead.
// The answer key is built from the same numbers, so it always matches the page.
import { PAGE_W, pageSvg, text, wrapText, escapeXml, safeColor } from './svg-templates.js'

export const CHART_TYPES = ['pictograph', 'bar', 'table']
export const CHART_ICONS = ['circle', 'star', 'square', 'heart', 'triangle']
export const CHART_LIMITS = {
  pictograph: { maxCategories: 6, maxValue: 12 },
  bar: { maxCategories: 6, maxValue: 20 },
  table: { maxCategories: 8, maxValue: 9999 },
}

/** Structural problems with a chart, as strings (empty = valid). Pure. */
export function validateChart(chart) {
  if (!chart || typeof chart !== 'object') return ['chart is not an object']
  const issues = []
  if (!CHART_TYPES.includes(chart.type)) return [`chart type "${chart.type}" must be one of ${CHART_TYPES.join(', ')}`]
  const { maxCategories, maxValue } = CHART_LIMITS[chart.type]
  const cats = chart.categories
  if (!Array.isArray(cats) || cats.length < 2) return ['chart needs at least 2 categories']
  if (cats.length > maxCategories) issues.push(`${chart.type} has ${cats.length} categories (max ${maxCategories})`)
  for (const c of cats) {
    if (!String(c?.label ?? '').trim()) issues.push('chart category with an empty label')
    if (!Number.isInteger(c?.value) || c.value < 0 || c.value > maxValue) {
      issues.push(`chart value for "${c?.label}" must be a whole number 0–${maxValue} (got ${c?.value})`)
    }
  }
  return issues
}

/**
 * Make an invalid chart drawable without changing any value. The model often
 * writes realistic numbers (40, 50) beyond the bar/picture-graph limits; if such a
 * chart were dropped the page would be drawn by the image model, which gets the
 * counts wrong while the answer key uses the real data. A table holds the same
 * numbers exactly, so an over-limit bar/pictograph becomes a table. Returns
 * { chart, changed }; `chart` is null when it cannot be repaired (bad values,
 * fewer than 2 or more than the table's row limit). Pure — exported for unit testing.
 */
export function repairChart(chart) {
  if (validateChart(chart).length === 0) return { chart, changed: false }
  const cats = Array.isArray(chart?.categories) ? chart.categories : []
  const table = CHART_LIMITS.table
  const drawable = cats.length >= 2 && cats.length <= table.maxCategories &&
    cats.every(c => String(c?.label ?? '').trim() && Number.isInteger(c?.value) && c.value >= 0 && c.value <= table.maxValue)
  if (!drawable) return { chart: null, changed: false }
  const { icon, labelHeader, valueHeader, ...rest } = chart
  return { chart: { ...rest, type: 'table', labelHeader, valueHeader }, changed: true }
}

// ---- icons ---------------------------------------------------------------

function iconSvg(shape, cx, cy, r, color) {
  const attrs = `fill="${color}" class="chart-icon"`
  switch (shape) {
    case 'square':
      return `<rect x="${cx - r * 0.85}" y="${cy - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="${r * 0.25}" ${attrs}/>`
    case 'triangle':
      return `<polygon points="${cx},${cy - r} ${cx + r * 0.95},${cy + r * 0.8} ${cx - r * 0.95},${cy + r * 0.8}" ${attrs}/>`
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rr = i % 2 === 0 ? r : r * 0.45
        return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
      })
      return `<polygon points="${pts.join(' ')}" ${attrs}/>`
    }
    case 'heart':
      return `<path d="M ${cx} ${cy + r * 0.85} C ${cx - r * 1.3} ${cy - r * 0.1}, ${cx - r * 0.6} ${cy - r * 1.05}, ${cx} ${cy - r * 0.35} C ${cx + r * 0.6} ${cy - r * 1.05}, ${cx + r * 1.3} ${cy - r * 0.1}, ${cx} ${cy + r * 0.85} Z" ${attrs}/>`
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r * 0.9}" ${attrs}/>`
  }
}

// ---- charts (drawn inside the box x0..x1, y0..y1) --------------------------

const LABEL_COLOR = '#222'
const GRID = '#cfcfcf'

function pictograph(chart, color, x0, y0, x1, y1) {
  const icon = CHART_ICONS.includes(chart.icon) ? chart.icon : 'circle'
  const n = chart.categories.length
  const keyH = 56
  const rowH = Math.min(92, (y1 - y0 - keyH) / n)
  const labelW = 230
  const r = Math.min(rowH * 0.34, 24)
  const step = r * 2 + 10
  let out = ''
  chart.categories.forEach((c, i) => {
    const top = y0 + i * rowH
    const cy = top + rowH / 2
    out += `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${rowH}" fill="${i % 2 ? '#fff' : '#f4f4f4'}" stroke="${GRID}"/>`
    const lines = wrapText(c.label, labelW - 20, 26, true).slice(0, 2)
    lines.forEach((l, j) => {
      out += text(x0 + labelW - 14, cy + 9 + (j - (lines.length - 1) / 2) * 28, l, { size: 26, weight: 'bold', fill: LABEL_COLOR, anchor: 'end' })
    })
    out += `<line x1="${x0 + labelW}" y1="${top}" x2="${x0 + labelW}" y2="${top + rowH}" stroke="${GRID}"/>`
    for (let k = 0; k < c.value; k++) out += iconSvg(icon, x0 + labelW + 20 + r + k * step, cy, r, color)
  })
  const keyY = y0 + n * rowH + keyH / 2 + 4
  const unit = chart.unit ? ` ${chart.unit}` : ''
  out += iconSvg(icon, x0 + labelW + 20 + r, keyY, r * 0.8, color).replace('class="chart-icon"', 'class="chart-key"')
  out += text(x0 + labelW + 20 + r * 2 + 14, keyY + 9, `= 1${unit}`, { size: 26, weight: 'bold', fill: LABEL_COLOR })
  out += text(x0, keyY + 9, 'Key:', { size: 26, weight: 'bold', fill: LABEL_COLOR })
  return out
}

function niceMax(max) {
  const step = max <= 10 ? 1 : 2
  return { top: Math.max(step * 2, Math.ceil(max / step) * step), step }
}

function bar(chart, color, x0, y0, x1, y1) {
  const n = chart.categories.length
  const axisX = x0 + 70
  const baseY = y1 - 70
  const topY = y0 + 10
  const { top, step } = niceMax(Math.max(...chart.categories.map(c => c.value)))
  const yFor = v => baseY - ((baseY - topY) * v) / top
  let out = ''
  for (let v = 0; v <= top; v += step) {
    const y = yFor(v)
    out += `<line x1="${axisX}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}"/>`
    out += text(axisX - 12, y + 8, String(v), { size: 22, fill: LABEL_COLOR, anchor: 'end' })
  }
  if (chart.unit) {
    out += `<text x="${x0 + 14}" y="${(topY + baseY) / 2}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="bold" fill="${LABEL_COLOR}" text-anchor="middle" transform="rotate(-90 ${x0 + 14} ${(topY + baseY) / 2})">${escapeXml(`Number of ${chart.unit}`)}</text>`
  }
  const slot = (x1 - axisX) / n
  const barW = Math.min(110, slot * 0.6)
  chart.categories.forEach((c, i) => {
    const cx = axisX + slot * (i + 0.5)
    const y = yFor(c.value)
    out += `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${baseY - y}" fill="${color}" class="chart-bar" data-value="${c.value}"/>`
    wrapText(c.label, slot - 10, 22, true).slice(0, 2).forEach((l, j) => {
      out += text(cx, baseY + 30 + j * 26, l, { size: 22, weight: 'bold', fill: LABEL_COLOR, anchor: 'middle' })
    })
  })
  out += `<line x1="${axisX}" y1="${topY}" x2="${axisX}" y2="${baseY}" stroke="${LABEL_COLOR}" stroke-width="3"/>`
  out += `<line x1="${axisX}" y1="${baseY}" x2="${x1}" y2="${baseY}" stroke="${LABEL_COLOR}" stroke-width="3"/>`
  return out
}

function table(chart, color, x0, y0, x1, y1) {
  const n = chart.categories.length
  const w = Math.min(640, x1 - x0)
  const left = (x0 + x1) / 2 - w / 2
  const rowH = Math.min(64, (y1 - y0) / (n + 1))
  const split = left + w * 0.62
  let out = `<rect x="${left}" y="${y0}" width="${w}" height="${rowH}" fill="${color}"/>`
  // Shrink a long header until it fits its column ("Number of Attendees" was cut to "Number of Attende").
  const header = (label, colW, cx) => {
    let size = 26
    while (size > 16 && wrapText(label, colW - 20, size, true).length > 1) size -= 2
    return text(cx, y0 + rowH / 2 + 9, label, { size, weight: 'bold', fill: '#fff', anchor: 'middle' })
  }
  out += header(chart.labelHeader || 'Item', split - left, (left + split) / 2)
  out += header(chart.valueHeader || (chart.unit ? `Number of ${chart.unit}` : 'Number'), left + w - split, (split + left + w) / 2)
  chart.categories.forEach((c, i) => {
    const top = y0 + (i + 1) * rowH
    out += `<rect x="${left}" y="${top}" width="${w}" height="${rowH}" fill="${i % 2 ? '#fff' : '#f4f4f4'}" stroke="${GRID}" class="chart-row"/>`
    out += text((left + split) / 2, top + rowH / 2 + 9, wrapText(c.label, split - left - 20, 26)[0], { size: 26, fill: LABEL_COLOR, anchor: 'middle' })
    out += text((split + left + w) / 2, top + rowH / 2 + 9, String(c.value), { size: 26, weight: 'bold', fill: LABEL_COLOR, anchor: 'middle' })
  })
  out += `<line x1="${split}" y1="${y0}" x2="${split}" y2="${y0 + (n + 1) * rowH}" stroke="${GRID}"/>`
  out += `<rect x="${left}" y="${y0}" width="${w}" height="${(n + 1) * rowH}" fill="none" stroke="${color}" stroke-width="3"/>`
  return out
}

const DRAW = { pictograph, bar, table }

// ---- questions with answer lines --------------------------------------------

function layoutQuestions(questions, scale, width) {
  const size = 27 * scale
  const indent = 52 * scale
  const items = []
  let y = 0
  for (const q of questions) {
    const lines = wrapText(q.question, width - indent, size)
    y += size * 1.2
    items.push({ kind: 'num', y, text: `${q.num}.`, size })
    lines.forEach((l, i) => items.push({ kind: 'q', y: y + i * size * 1.25, text: l, size, indent }))
    y += (lines.length - 1) * size * 1.25 + size * 1.7
    items.push({ kind: 'line', y, indent })
    y += size * 0.5
  }
  return { items, height: y }
}

/**
 * Build a chart worksheet page: frame/header, instruction, chart title, the
 * code-drawn chart, then each question with a blank answer line. Pure.
 */
export function chartPageSvg(plan, page) {
  const color = safeColor(plan.themeColor)
  const chart = page.content.chart
  const left = 80
  const right = PAGE_W - 80
  const noun = chart.type === 'table' ? 'table' : chart.type === 'bar' ? 'bar graph' : 'picture graph'

  let body = text(left, 196, `Use the ${noun} to answer the questions.`, { size: 27, weight: 'bold', fill: LABEL_COLOR })
  // Shrink a long chart title until it fits on one line (never truncate it).
  const title = chart.title || page.content.title || ''
  let titleSize = 34
  while (titleSize > 20 && wrapText(title, right - left, titleSize, true).length > 1) titleSize -= 2
  body += text(PAGE_W / 2, 252, title, { size: titleSize, weight: 'bold', fill: color, anchor: 'middle' })
  const n = chart.categories.length
  const chartBottom = {
    table: 285 + Math.min(64, 545 / (n + 1)) * (n + 1),
    pictograph: 285 + Math.min(92, (545 - 56) / n) * n + 56,
    bar: 830,
  }[chart.type]
  body += DRAW[chart.type](chart, color, left, 285, right, chartBottom)

  const qTop = chartBottom + 30
  const available = 1480 - qTop
  let scale = 1
  let layout = layoutQuestions(page.content.questions ?? [], scale, right - left)
  while (layout.height > available && scale > 0.5) {
    scale -= 0.05
    layout = layoutQuestions(page.content.questions ?? [], scale, right - left)
  }
  body += layout.items.map(it => {
    const y = qTop + it.y
    if (it.kind === 'num') return text(left, y, it.text, { size: it.size, weight: 'bold', fill: color })
    if (it.kind === 'q') return text(left + it.indent, y, it.text, { size: it.size, fill: LABEL_COLOR })
    return `<line x1="${left + it.indent}" y1="${y}" x2="${right}" y2="${y}" stroke="#888" stroke-width="2"/>`
  }).join('')

  return pageSvg(plan, `Page ${page.pageNum} of ${plan.pageCount}`, body)
}
