// `multiple_choice` layout: numbered questions, each followed by 2–4 lettered
// bubbles (A–D). Options go on one line when they all fit, else two per line,
// else one per line (wrapped). Overflow: shrink → two columns → LayoutOverflowError.
import { measureText, wrapText, cleanText } from './measure.js'
import { textEl, numberBadge, r1 } from './decor.js'
import { page, textBox, DESC } from './worksheet.js'
import { LETTERS } from './specs.js'

function bubble(cx, cy, r, letter, pal, size) {
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="#fff" stroke="${pal.c}" stroke-width="3"/>` +
    textEl(cx, cy + size * 0.35, letter, { size, weight: 'bold', fill: pal.c, anchor: 'middle' })
}

/** One question row: badge + bold question, then the option bubbles. */
export function choiceRow(q, s, pal, index) {
  return {
    build(width) {
      const padX = s * 0.45
      const padY = s * 0.38
      const r = s * 0.95
      const tx = 2 * r + s * 0.55
      const textW = width - 2 * padX - tx
      if (textW < s * 6) return null
      const lh = s * 1.3
      const lines = wrapText(q.question, textW, s, { bold: true })
      const os = s * 0.9
      const br = os * 0.68
      const olh = os * 1.25
      const gapX = os * 0.9
      const labelX = 2 * br + os * 0.45
      const opts = q.options.map(o => cleanText(o).trim())
      const n = opts.length
      let layout = null
      for (const perRow of [...new Set([n, 2, 1])].filter(k => k <= n)) {
        const slotW = (textW - (perRow - 1) * gapX) / perRow
        const wrapped = opts.map(o => wrapText(o, slotW - labelX, os))
        if (perRow > 1 && wrapped.some(w => w.length > (perRow === n ? 1 : 2))) continue
        const rows = []
        for (let i = 0; i < n; i += perRow) rows.push(Math.max(...wrapped.slice(i, i + perRow).map(w => w.length)))
        layout = { perRow, slotW, wrapped, rows }
        break
      }
      const firstBase = r + s * 0.36
      const qBottom = Math.max(firstBase + (lines.length - 1) * lh + DESC * s, 2 * r)
      const rowH = (k) => Math.max(2 * br, k * olh) + os * 0.45
      const optsH = layout.rows.reduce((t, k) => t + rowH(k), 0)
      const h = qBottom + s * 0.45 + optsH + 2 * padY
      return {
        h,
        lines: lines.length + layout.rows.length,
        render(x, y) {
          const top = y + padY
          const left = x + padX
          const boxes = [{ kind: 'bg', x, y, w: width, h }]
          let svg = index % 2 === 0 ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" rx="${r1(s * 0.6)}" fill="${pal.pale}"/>` : ''
          svg += numberBadge(left + r, top + r, r, q.num, pal.c)
          boxes.push({ kind: 'badge', x: left, y: top, w: 2 * r, h: 2 * r })
          lines.forEach((l, i) => {
            const base = top + firstBase + i * lh
            svg += textEl(left + tx, base, l, { size: s, weight: 'bold', fill: '#222' })
            boxes.push(textBox(left + tx, base, measureText(l, s, { bold: true }), s))
          })
          let oy = top + qBottom + s * 0.45
          layout.rows.forEach((k, ri) => {
            const rh = rowH(k)
            for (let c = 0; c < layout.perRow; c++) {
              const i = ri * layout.perRow + c
              if (i >= opts.length) break
              const ox = left + tx + c * (layout.slotW + gapX)
              const cy = oy + br
              svg += bubble(ox + br, cy, br, LETTERS[i], pal, os * 0.82)
              boxes.push({ kind: 'answer', x: ox, y: oy, w: 2 * br, h: 2 * br })
              layout.wrapped[i].forEach((l, li) => {
                const base = cy + os * 0.35 + li * olh
                svg += textEl(ox + labelX, base, l, { size: os, fill: '#222' })
                boxes.push(textBox(ox + labelX, base, measureText(l, os), os))
              })
            }
            oy += rh
          })
          return { svg, boxes }
        },
      }
    },
  }
}

/**
 * Multiple-choice page from a validated spec ({ questions: [{ num, question, options, answer }] }).
 * The answer is never printed; layoutAnswerKey('multiple_choice', spec) gives the key.
 */
export function multipleChoicePageSvg(plan, pg, spec, { art = null } = {}) {
  return page(plan, pg, {
    art,
    instructionText: 'Read each question. Fill in the bubble next to the correct answer.',
    blocksFor: (s, pal) => spec.questions.map((q, i) => choiceRow(q, s, pal, i)),
    twoColumn: true,
  })
}
