// `table_fill` layout: a code-drawn table (header row in the theme colour, zebra
// rows) whose blank cells ({ answer }) are left empty for the student, plus
// optional numbered questions about the printed table. Column widths follow the
// measured content; cells wrap. Overflow: shrink, drop art, then throw.
import { measureText, wrapText, cleanText } from './measure.js'
import { textEl, r1 } from './decor.js'
import { page, textBox, questionRow, DESC } from './worksheet.js'

const isBlank = (c) => !!c && typeof c === 'object'
const longestWord = (t, size, bold) => Math.max(0, ...cleanText(t).split(/\s+/).map(w => measureText(w, size, { bold })))

function tableBlock(columns, rows, s, pal) {
  return {
    floatable: false,
    span: true,
    build(width) {
      const n = columns.length
      const pad = s * 0.45
      const hs = s * 0.95
      const cell = (c) => (isBlank(c) ? '' : cleanText(c).trim())
      // Natural (one-line) and minimum (longest word) widths per column.
      const nat = columns.map((h, j) => Math.max(
        measureText(h, hs, { bold: true }),
        ...rows.map(r => (isBlank(r[j]) ? Math.max(s * 4, measureText(r[j].answer, s) * 1.3) : measureText(cell(r[j]), s))),
      ) + 2 * pad)
      const min = columns.map((h, j) => Math.max(
        longestWord(h, hs, true), s * 3,
        ...rows.map(r => (isBlank(r[j]) ? s * 3.5 : longestWord(cell(r[j]), s, false))),
      ) + 2 * pad)
      if (min.reduce((a, b) => a + b, 0) > width) return null
      const natSum = nat.reduce((a, b) => a + b, 0)
      let widths
      if (natSum <= width) widths = nat.map(w => w * width / natSum)
      else {
        // Give every column its minimum, then share the rest by how much more it wants.
        const spare = width - min.reduce((a, b) => a + b, 0)
        const want = nat.map((w, j) => w - min[j])
        const wantSum = want.reduce((a, b) => a + b, 0) || 1
        widths = min.map((m, j) => m + spare * want[j] / wantSum)
      }
      const lh = s * 1.2
      const headLines = columns.map((h, j) => wrapText(h, widths[j] - 2 * pad, hs, { bold: true }))
      const bodyLines = rows.map(r => r.map((c, j) => (isBlank(c) ? [] : wrapText(cell(c), widths[j] - 2 * pad, s))))
      const rowH = (lines, size) => Math.max(s * 2.3, Math.max(1, ...lines.map(l => l.length)) * lh - (lh - (0.93 + DESC) * size) + 2 * pad)
      const headH = rowH(headLines, hs)
      const heights = bodyLines.map(l => rowH(l, s))
      const h = headH + heights.reduce((a, b) => a + b, 0)
      return {
        h,
        render(x, y) {
          let svg = ''
          const boxes = []
          const xs = widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [x])
          const put = (lines, x0, w, top, ht, size, bold, fill) => {
            const t0 = top + (ht - ((lines.length - 1) * lh + (0.93 + DESC) * size)) / 2 + 0.93 * size
            lines.forEach((l, i) => {
              const tw = measureText(l, size, { bold })
              svg += textEl(x0 + w / 2, t0 + i * lh, l, { size, weight: bold ? 'bold' : 'normal', fill, anchor: 'middle' })
              boxes.push(textBox(x0 + w / 2 - tw / 2, t0 + i * lh, tw, size))
            })
          }
          svg += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(headH)}" fill="${pal.c}"/>`
          boxes.push({ kind: 'bg', x, y, w: width, h: headH })
          columns.forEach((c, j) => put(headLines[j], xs[j], widths[j], y, headH, hs, true, '#fff'))
          let ry = y + headH
          rows.forEach((r, i) => {
            const ht = heights[i]
            svg += `<rect x="${r1(x)}" y="${r1(ry)}" width="${r1(width)}" height="${r1(ht)}" fill="${i % 2 ? pal.pale : '#fff'}"/>`
            boxes.push({ kind: 'bg', x, y: ry, w: width, h: ht })
            r.forEach((c, j) => {
              if (isBlank(c)) {
                const ix = xs[j] + pad * 0.6
                const iy = ry + pad * 0.6
                svg += `<rect x="${r1(ix)}" y="${r1(iy)}" width="${r1(widths[j] - pad * 1.2)}" height="${r1(ht - pad * 1.2)}" rx="${r1(s * 0.3)}" fill="#fff" stroke="${pal.accent}" stroke-width="2.5" stroke-dasharray="7 6"/>`
                boxes.push({ kind: 'answer', x: ix, y: iy, w: widths[j] - pad * 1.2, h: ht - pad * 1.2 })
              } else put(bodyLines[i][j], xs[j], widths[j], ry, ht, s, j === 0, '#222')
            })
            ry += ht
          })
          // grid + outer border on top of the fills
          for (let j = 1; j < columns.length; j++) svg += `<line x1="${r1(xs[j])}" y1="${r1(y)}" x2="${r1(xs[j])}" y2="${r1(y + h)}" stroke="${pal.accent}" stroke-width="2"/>`
          let gy = y + headH
          for (const ht of heights.slice(0, -1)) { gy += ht; svg += `<line x1="${r1(x)}" y1="${r1(gy)}" x2="${r1(x + width)}" y2="${r1(gy)}" stroke="${pal.accent}" stroke-width="2"/>` }
          svg += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" rx="${r1(s * 0.4)}" fill="none" stroke="${pal.c}" stroke-width="4"/>`
          return { svg, boxes }
        },
      }
    },
  }
}

/** Fill-in table page from a validated spec ({ columns, rows, questions? }). */
export function tableFillPageSvg(plan, pg, spec, { art = null } = {}) {
  const qs = spec.questions ?? []
  return page(plan, pg, {
    art,
    instructionText: qs.length ? 'Fill in the empty boxes in the table. Then answer the questions.' : 'Fill in the empty boxes in the table.',
    blocksFor: (s, pal) => [
      tableBlock(spec.columns, spec.rows, s, pal),
      ...qs.map((q, i) => ({ ...questionRow(q, s, pal, i + 1), floatable: false })),
    ],
    bandOnly: true,
  })
}
