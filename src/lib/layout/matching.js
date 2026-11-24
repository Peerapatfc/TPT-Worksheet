// `matching` layout (word ↔ meaning): numbered terms on the left, lettered
// meanings on the right in a code-shuffled order (seeded by the terms, never in
// answer order), a connector dot on each inner card edge for drawing lines and a
// small box for writing the letter. The key comes from the same shuffle
// (layoutAnswerKey). Overflow: shrink, drop the illustration, then throw.
import { measureText, wrapText, cleanText } from './measure.js'
import { textEl, numberBadge, answerBox, r1 } from './decor.js'
import { page, textBox, DESC } from './worksheet.js'
import { LETTERS, matchingOrder } from './specs.js'

const card = (x, y, w, h, s, pal) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(s * 0.55)}" fill="${pal.pale}" stroke="${pal.accent}" stroke-width="2.5"/>`
const dot = (cx, cy, r, pal) => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${pal.c}"/><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.4)}" fill="#fff"/>`

function pairRow(term, num, meaning, letter, s, pal, termW) {
  return {
    floatable: false,
    build(width) {
      const pad = s * 0.4
      const r = s * 0.85
      const dr = s * 0.32
      const box = s * 1.5
      const mid = Math.max(s * 3.2, width * 0.12) // drawing gap between the cards
      const leftW = Math.min(width * 0.44, Math.max(width * 0.3, termW + 2 * r + box + pad * 4 + s * 0.6))
      const rightW = width - leftW - mid
      const termTextW = leftW - 2 * pad - 2 * r - s * 0.4 - box - s * 0.4
      const meanTextW = rightW - 2 * pad - 2 * r - s * 0.4
      if (termTextW < s * 3 || meanTextW < s * 6) return null
      const lh = s * 1.25
      const ms = s * 0.92
      const mlh = ms * 1.25
      const tl = wrapText(term, termTextW, s, { bold: true })
      const ml = wrapText(meaning, meanTextW, ms)
      const inner = (n, size, l) => (n - 1) * l + (0.93 + DESC) * size
      const h = Math.max(2 * r, box, inner(tl.length, s, lh), inner(ml.length, ms, mlh)) + 2 * pad
      return {
        h,
        lines: Math.max(tl.length, ml.length),
        render(x, y) {
          const boxes = [{ kind: 'bg', x, y, w: leftW, h }, { kind: 'bg', x: x + leftW + mid, y, w: rightW, h }]
          let svg = card(x, y, leftW, h, s, pal) + card(x + leftW + mid, y, rightW, h, s, pal)
          const cy = y + h / 2
          // left: badge, term, letter box, dot on the right edge
          svg += numberBadge(x + pad + r, cy, r, num, pal.c)
          boxes.push({ kind: 'badge', x: x + pad, y: cy - r, w: 2 * r, h: 2 * r })
          const tx = x + pad + 2 * r + s * 0.4
          const t0 = cy - inner(tl.length, s, lh) / 2 + 0.93 * s
          tl.forEach((l, i) => {
            svg += textEl(tx, t0 + i * lh, l, { size: s, weight: 'bold', fill: '#222' })
            boxes.push(textBox(tx, t0 + i * lh, measureText(l, s, { bold: true }), s))
          })
          const bx = x + leftW - pad - box
          svg += answerBox(bx, cy - box / 2, box, box, pal.c)
          boxes.push({ kind: 'answer', x: bx, y: cy - box / 2, w: box, h: box })
          svg += dot(x + leftW, cy, dr, pal) + dot(x + leftW + mid, cy, dr, pal)
          // right: letter badge + meaning
          const rx = x + leftW + mid
          svg += numberBadge(rx + pad + r, cy, r, letter, pal.warm)
          boxes.push({ kind: 'badge', x: rx + pad, y: cy - r, w: 2 * r, h: 2 * r })
          const mx = rx + pad + 2 * r + s * 0.4
          const m0 = cy - inner(ml.length, ms, mlh) / 2 + 0.93 * ms
          ml.forEach((l, i) => {
            svg += textEl(mx, m0 + i * mlh, l, { size: ms, fill: '#222' })
            boxes.push(textBox(mx, m0 + i * mlh, measureText(l, ms), ms))
          })
          return { svg, boxes }
        },
      }
    },
  }
}

/** Matching page from a validated spec ({ pairs: [{ term, match }] }). */
export function matchingPageSvg(plan, pg, spec, { art = null } = {}) {
  const order = matchingOrder(spec)
  const terms = spec.pairs.map(p => cleanText(p.term).trim())
  return page(plan, pg, {
    art,
    instructionText: 'Draw a line from each word to its meaning. Write the letter in the box.',
    blocksFor: (s, pal) => {
      const termW = Math.max(...terms.map(t => measureText(t, s, { bold: true })))
      return terms.map((t, i) => pairRow(t, i + 1, cleanText(spec.pairs[order[i]].match).trim(), LETTERS[i], s, pal, termW))
    },
    bandOnly: true,
  })
}
