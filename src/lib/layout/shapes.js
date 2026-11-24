// `shapes` layout (code-only, no FLUX): a grid of cards, each with a figure drawn
// by code — a fraction shape split into equal parts (some shaded), a group of
// icons to count, or a polygon — plus the question and an answer box. Questions
// and answers are generated from the numbers (shapeItemQA), so the picture, the
// question and the key always agree. Overflow: shrink, then throw.
import { measureText, wrapText } from './measure.js'
import { textEl, numberBadge, answerBox, r1 } from './decor.js'
import { page, textBox, DESC } from './worksheet.js'
import { iconSvg } from '../chart-page.js'
import { shapeItemQA } from './specs.js'

const STROKE = '#333'

/** Most square grid (rows × cols, rows ≤ cols) for `n` equal parts. Pure. */
export function partGrid(n) {
  let best = [1, n]
  for (let r = 1; r * r <= n; r++) if (n % r === 0) best = [r, n / r]
  return best
}

function fractionFigure(it, cx, cy, size, pal) {
  const shaded = it.ask === 'shade' ? 0 : it.shaded
  const fill = (i) => (i < shaded ? pal.c : '#fff')
  if (it.shape === 'circle') {
    const r = size * 0.46
    let out = ''
    for (let i = 0; i < it.parts; i++) {
      const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / it.parts
      const a1 = a0 + (2 * Math.PI) / it.parts
      const p = (a) => `${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`
      out += `<path d="M${r1(cx)} ${r1(cy)} L${p(a0)} A${r1(r)} ${r1(r)} 0 0 1 ${p(a1)} Z" fill="${fill(i)}" stroke="${STROKE}" stroke-width="3" stroke-linejoin="round"/>`
    }
    return out
  }
  const [rows, cols] = it.shape === 'bar' ? [1, it.parts] : partGrid(it.parts)
  const unit = Math.min((size * 0.92) / cols, (size * (it.shape === 'bar' ? 0.4 : 0.92)) / rows)
  const w = unit * cols
  const h = it.shape === 'bar' ? Math.min(size * 0.32, unit * 1.6) : unit * rows
  const cw = w / cols
  const ch = h / rows
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  let out = ''
  for (let i = 0; i < it.parts; i++) {
    const rr = Math.floor(i / cols)
    const cc = i % cols
    out += `<rect x="${r1(x0 + cc * cw)}" y="${r1(y0 + rr * ch)}" width="${r1(cw)}" height="${r1(ch)}" fill="${fill(i)}" stroke="${STROKE}" stroke-width="3"/>`
  }
  return out
}

function countFigure(it, cx, cy, size, pal) {
  const cols = Math.min(5, it.count)
  const rows = Math.ceil(it.count / 5)
  const step = Math.min(size / cols, size / Math.max(rows, 2))
  const r = step * 0.38
  const x0 = cx - (cols * step) / 2 + step / 2
  const y0 = cy - (rows * step) / 2 + step / 2
  let out = ''
  for (let i = 0; i < it.count; i++) out += iconSvg(it.icon, r1(x0 + (i % 5) * step), r1(y0 + Math.floor(i / 5) * step), r1(r), pal.c)
  return out
}

function polygonFigure(it, cx, cy, size, pal) {
  const s = size * 0.44
  const attrs = `fill="${pal.soft}" stroke="${pal.c}" stroke-width="5" stroke-linejoin="round"`
  const pts = (list) => `<polygon points="${list.map(([x, y]) => `${r1(cx + x * s)},${r1(cy + y * s)}`).join(' ')}" ${attrs}/>`
  const regular = (n) => Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n % 2 === 0 ? Math.PI / n : 0)
    return [Math.cos(a), Math.sin(a)]
  })
  switch (it.shape) {
    case 'circle': return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(s)}" ${attrs}/>`
    case 'square': return pts([[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]])
    case 'rectangle': return pts([[-1, -0.58], [1, -0.58], [1, 0.58], [-1, 0.58]])
    case 'rhombus': return pts([[0, -1], [0.7, 0], [0, 1], [-0.7, 0]])
    case 'trapezoid': return pts([[-0.55, -0.6], [0.55, -0.6], [1, 0.6], [-1, 0.6]])
    case 'triangle': return pts([[0, -0.95], [1, 0.75], [-1, 0.75]])
    case 'pentagon': return pts(regular(5))
    case 'hexagon': return pts(regular(6))
    case 'octagon': return pts(regular(8))
    default: return ''
  }
}

function figureSvg(it, cx, cy, size, pal) {
  if (it.kind === 'fraction') return fractionFigure(it, cx, cy, size, pal)
  if (it.kind === 'count') return countFigure(it, cx, cy, size, pal)
  return polygonFigure(it, cx, cy, size, pal)
}

/** A row of `cols` item cards. */
function cardRow(items, startNum, cols, s, pal) {
  return {
    floatable: false,
    build(width) {
      const gap = s * 0.7
      const cw = (width - (cols - 1) * gap) / cols
      const pad = s * 0.5
      const qs = s * (cols >= 3 ? 0.78 : 0.9) // question text: cards are narrow
      const r = qs * 0.85
      const fig = Math.min(cw - 2 * pad, s * 8.5)
      const tx = 2 * r + s * 0.4
      const textW = cw - 2 * pad - tx
      if (fig < s * 3.5 || textW < s * 4) return null
      const lh = qs * 1.25
      const qa = items.map(shapeItemQA)
      const lines = qa.map(q => wrapText(q.question, textW, qs, { bold: true }))
      const nLines = Math.max(...lines.map(l => l.length))
      const boxH = s * 1.9
      const boxW = Math.min(textW, Math.max(s * 5, ...qa.map(q => measureText(q.answer, s) + s * 2)))
      const textH = Math.max(2 * r, r + qs * 0.36 + (nLines - 1) * lh + DESC * qs)
      const h = pad + fig + s * 0.4 + textH + s * 0.5 + boxH + pad
      return {
        h,
        lines: nLines,
        render(x, y) {
          let svg = ''
          const boxes = []
          items.forEach((it, i) => {
            const cx = x + i * (cw + gap)
            svg += `<rect x="${r1(cx)}" y="${r1(y)}" width="${r1(cw)}" height="${r1(h)}" rx="${r1(s * 0.6)}" fill="#fff" stroke="${pal.accent}" stroke-width="3"/>`
            boxes.push({ kind: 'bg', x: cx, y, w: cw, h })
            const fx = cx + cw / 2
            const fy = y + pad + fig / 2
            svg += `<g class="shape-figure">${figureSvg(it, fx, fy, fig * 0.92, pal)}</g>`
            boxes.push({ kind: 'figure', x: fx - fig / 2, y: y + pad, w: fig, h: fig })
            const ty = y + pad + fig + s * 0.4
            svg += numberBadge(cx + pad + r, ty + r, r, startNum + i, pal.c)
            boxes.push({ kind: 'badge', x: cx + pad, y: ty, w: 2 * r, h: 2 * r })
            const t0 = ty + r + qs * 0.36
            lines[i].forEach((l, j) => {
              const w = measureText(l, qs, { bold: true })
              svg += textEl(cx + pad + tx, t0 + j * lh, l, { size: qs, weight: 'bold', fill: '#222' })
              boxes.push(textBox(cx + pad + tx, t0 + j * lh, w, qs))
            })
            const by = y + h - pad - boxH
            svg += answerBox(cx + (cw - boxW) / 2, by, boxW, boxH, pal.c)
            boxes.push({ kind: 'answer', x: cx + (cw - boxW) / 2, y: by, w: boxW, h: boxH })
          })
          return { svg, boxes }
        },
      }
    },
  }
}

/** Columns per row for n items. Pure. */
export const shapeColumns = (n) => (n <= 2 ? n : n === 4 ? 2 : 3)

/** Shapes page from a validated spec ({ items: [ShapeItem] }); never uses FLUX. */
export function shapesPageSvg(plan, pg, spec) {
  const cols = shapeColumns(spec.items.length)
  const rows = []
  for (let i = 0; i < spec.items.length; i += cols) rows.push(spec.items.slice(i, i + cols))
  const shade = spec.items.some(it => it.kind === 'fraction' && it.ask === 'shade')
  return page(plan, pg, {
    art: null,
    instructionText: shade ? 'Look at each shape. Shade or answer as asked, then write your answer in the box.' : 'Look at each picture. Write your answer in the box.',
    blocksFor: (s, pal) => rows.map((row, i) => cardRow(row, i * cols + 1, cols, s, pal)),
  })
}
