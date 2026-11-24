// `labeling` layout: a large FLUX illustration of the subject, numbered clue
// callouts beside it (positions decided by code), a word bank and a writing line
// per callout. What is guaranteed: every word, clue and number is printed exactly
// from the spec, the word bank holds exactly the answers (code-shuffled), and the
// key is "number → word" from the spec. What is NOT guaranteed: that the picture
// shows each part, or where — FLUX cannot place parts on demand. So callout leader
// lines stop at the picture's edge and never point into it, and every callout is
// answerable from its clue + word bank alone; the picture is decorative context.
// Overflow: picture beside the callouts → picture above them (two columns) →
// no picture → LayoutOverflowError.
import { measureText, wrapText, cleanText, LayoutOverflowError } from './measure.js'
import { textEl, numberBadge, answerLine, illustrationEl, motifBlock, r1 } from './decor.js'
import { shell, pageDoc, wordBankBlock, textBox, CONTENT, SIZES, DESC } from './worksheet.js'
import { labelingBankOrder } from './specs.js'

const GUTTER = 56
const SIDE_ART = { minW: 300, maxW: 430, minH: 300 }
const TOP_ART = { minH: 240, maxH: 420 }

function calloutCard(clue, num, s, pal) {
  return {
    build(width) {
      const pad = s * 0.4
      const r = s * 0.85
      const tx = 2 * r + s * 0.45
      const cs = s * 0.92
      const lh = cs * 1.28
      const textW = width - 2 * pad - tx
      if (textW < s * 5) return null
      const lines = wrapText(clue, textW, cs)
      const textH = Math.max(2 * r, r + cs * 0.36 + (lines.length - 1) * lh + DESC * cs)
      const h = pad + textH + s * 1.55 + pad
      return {
        h,
        render(x, y) {
          const boxes = [{ kind: 'bg', x, y, w: width, h }]
          let svg = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" rx="${r1(s * 0.55)}" fill="${pal.pale}" stroke="${pal.accent}" stroke-width="2.5"/>`
          svg += numberBadge(x + pad + r, y + pad + r, r, num, pal.c)
          boxes.push({ kind: 'badge', x: x + pad, y: y + pad, w: 2 * r, h: 2 * r })
          const t0 = y + pad + r + cs * 0.36
          lines.forEach((l, i) => {
            svg += textEl(x + pad + tx, t0 + i * lh, l, { size: cs, fill: '#222' })
            boxes.push(textBox(x + pad + tx, t0 + i * lh, measureText(l, cs), cs))
          })
          const ly = y + h - pad - s * 0.35
          svg += answerLine(x + pad + tx, x + width - pad, ly, pal.c)
          boxes.push({ kind: 'answer', x: x + pad + tx, y: ly - 2, w: width - 2 * pad - tx, h: 4 })
          return { svg, boxes }
        },
      }
    },
  }
}

function artSvg(art, slot, pal, motifName) {
  if (art?.ill) return illustrationEl(art.ill, slot, pal).svg
  const side = Math.min(slot.w, slot.h)
  return motifBlock(motifName, slot.x + (slot.w - side) / 2, slot.y + (slot.h - side) / 2, side, side, pal)
}

/** Stack built cards from y; returns { svg, boxes, end, mids }. */
function stack(built, x, y, gap) {
  let svg = ''
  const boxes = []
  const mids = []
  let cy = y
  for (const b of built) {
    const out = b.render(x, cy)
    svg += out.svg
    boxes.push(...out.boxes)
    mids.push(cy + b.h / 2)
    cy += b.h + gap
  }
  return { svg, boxes, end: cy - gap, mids }
}

function tryLayout(mode, { s, labels, bankWords, top, pal, art, motifName }) {
  const left = CONTENT.left
  const W = CONTENT.right - CONTENT.left
  const gap = s * 0.45
  const bank = wordBankBlock(bankWords, s, pal).build(W)
  if (!bank) return null
  let y = top + bank.h + s * 0.7
  const avail = CONTENT.bottom - y
  const cards = labels.map((l, i) => calloutCard(cleanText(l.clue).trim(), i + 1, s, pal))
  const heightOf = (list) => list.reduce((t, b) => t + b.h, 0) + gap * Math.max(0, list.length - 1)
  const bankOut = bank.render(left, top)
  let svg = bankOut.svg
  const boxes = [...bankOut.boxes]

  if (mode === 'side') {
    const artW = Math.min(SIDE_ART.maxW, Math.max(SIDE_ART.minW, W * 0.52))
    const cardW = W - artW - GUTTER
    const built = cards.map(c => c.build(cardW))
    if (built.some(b => !b)) return null
    const h = heightOf(built)
    if (h > avail) return null
    const slotH = Math.min(avail, Math.max(h, SIDE_ART.minH, artW))
    const extra = Math.min((avail - Math.max(h, slotH)) / 2, s * 2)
    y += Math.max(0, extra)
    const slot = { x: left, y: y + Math.max(0, (Math.max(h, slotH) - slotH) / 2), w: artW, h: slotH }
    const st = stack(built, left + artW + GUTTER, y + Math.max(0, (slotH - h) / 2), gap)
    svg += artSvg(art, slot, pal, motifName) + st.svg
    boxes.push({ kind: 'art', ...slot }, ...st.boxes)
    // Leader lines: from each card's left edge to the picture's right edge (never into it).
    for (const m of st.mids) {
      const ly = Math.min(Math.max(m, slot.y + 12), slot.y + slot.h - 12)
      svg += `<path d="M${r1(left + artW + GUTTER)} ${r1(m)} L${r1(left + artW + 10)} ${r1(ly)}" stroke="${pal.c}" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" fill="none"/>` +
        `<circle cx="${r1(left + artW + 8)}" cy="${r1(ly)}" r="6" fill="${pal.c}"/>`
    }
    return { svg, boxes, meta: { size: s, art: 'side' } }
  }

  // 'top' (picture band, then cards in two columns) or 'none' (cards only).
  const colW = (W - s * 0.9) / 2
  const built = cards.map(c => c.build(colW))
  if (built.some(b => !b)) return null
  const half = Math.ceil(built.length / 2)
  const h = Math.max(heightOf(built.slice(0, half)), heightOf(built.slice(half)))
  let artH = 0
  if (mode === 'top') {
    artH = Math.min(TOP_ART.maxH, avail - h - s)
    if (artH < TOP_ART.minH) return null
    const slot = { x: left + (W - Math.min(W, artH * 1.5)) / 2, y, w: Math.min(W, artH * 1.5), h: artH }
    svg += artSvg(art, slot, pal, motifName)
    boxes.push({ kind: 'art', ...slot })
    y += artH + s
  } else if (h > avail) return null
  const a = stack(built.slice(0, half), left, y, gap)
  const b = stack(built.slice(half), left + colW + s * 0.9, y, gap)
  svg += a.svg + b.svg
  boxes.push(...a.boxes, ...b.boxes)
  return { svg, boxes, meta: { size: s, art: mode === 'top' ? 'top' : art ? 'dropped' : 'none' } }
}

/**
 * Labeling page from a validated spec ({ subject, labels: [{ word, clue }] }).
 * `art`: prepared illustration ({ ill }), `true` for the motif fallback, or null.
 */
export function labelingPageSvg(plan, pg, spec, { art = null } = {}) {
  const sh = shell(plan, pg, 'Read each clue. Write the matching word from the word bank on the line.')
  const bankWords = labelingBankOrder(spec).map(i => cleanText(spec.labels[i].word).trim())
  const ctx = { labels: spec.labels, bankWords, top: sh.top, pal: sh.pal, art, motifName: sh.motifName }
  const attempts = []
  const sizes = SIZES.filter(s => s <= 28)
  if (art) for (const s of sizes) attempts.push(['side', s], ['top', s])
  for (const s of sizes) attempts.push(['none', s])
  for (const [mode, s] of attempts) {
    const body = tryLayout(mode, { ...ctx, s })
    if (body) return { svg: pageDoc(sh.svg, body.svg), boxes: [...sh.boxes, ...body.boxes], meta: body.meta }
  }
  throw new LayoutOverflowError('labeling content does not fit the page even without the picture')
}
