// `activity_art` layout: an instruction (up to 3 lines), one large FLUX line-art
// illustration to colour (no vignette, so the page stays white for printing) and
// up to 3 short task lines with tick boxes. No answers: activity pages get no
// answer-key entries. Overflow: shrink the task text → LayoutOverflowError when
// the picture would be smaller than ART_MIN_H.
import { measureText, wrapText, cleanText, LayoutOverflowError } from './measure.js'
import { textEl, illustrationEl, motifBlock, r1 } from './decor.js'
import { shell, pageDoc, textBox, CONTENT, DESC } from './worksheet.js'

const ART_MIN_H = 420
const TASK_SIZES = [28, 26, 24, 22, 20, 18]

function tasksBlock(tasks, s, width, pal) {
  const box = s * 1.05
  const tx = box + s * 0.6
  const lh = s * 1.3
  const rows = tasks.map(t => wrapText(t, width - tx, s))
  const gap = s * 0.55
  const h = rows.reduce((t, l) => t + Math.max(box, (l.length - 1) * lh + (0.93 + DESC) * s), 0) + gap * Math.max(0, rows.length - 1)
  return {
    h,
    render(x, y) {
      let svg = ''
      const boxes = []
      let cy = y
      rows.forEach(lines => {
        svg += `<rect x="${r1(x)}" y="${r1(cy)}" width="${r1(box)}" height="${r1(box)}" rx="${r1(box * 0.22)}" fill="#fff" stroke="${pal.c}" stroke-width="3.5"/>`
        boxes.push({ kind: 'answer', x, y: cy, w: box, h: box })
        lines.forEach((l, i) => {
          const base = cy + box / 2 + s * 0.35 + i * lh
          svg += textEl(x + tx, base, l, { size: s, fill: '#222' })
          boxes.push(textBox(x + tx, base, measureText(l, s), s))
        })
        cy += Math.max(box, (lines.length - 1) * lh + (0.93 + DESC) * s) + gap
      })
      return { svg, boxes }
    },
  }
}

/**
 * Colouring / activity page from a validated spec ({ subject, instruction, tasks? }).
 * `art`: prepared line-art illustration ({ ill }), `true` for the motif fallback, or null.
 */
export function activityArtPageSvg(plan, pg, spec, { art = null } = {}) {
  const sh = shell(plan, pg, cleanText(spec.instruction).trim(), { maxLines: 3 })
  const W = CONTENT.right - CONTENT.left
  const tasks = (spec.tasks ?? []).map(t => cleanText(t).trim()).filter(Boolean)
  for (const s of tasks.length ? TASK_SIZES : [0]) {
    const tb = tasks.length ? tasksBlock(tasks, s, W - 40, sh.pal) : null
    const tasksTop = tb ? CONTENT.bottom - tb.h : CONTENT.bottom
    const slot = { x: CONTENT.left, y: sh.top + 6, w: W, h: tasksTop - (tb ? 28 : 0) - sh.top - 6 }
    if (slot.h < ART_MIN_H) continue
    let svg = `<rect x="${r1(slot.x)}" y="${r1(slot.y)}" width="${r1(slot.w)}" height="${r1(slot.h)}" rx="26" fill="#fff" stroke="${sh.pal.accent}" stroke-width="3" stroke-dasharray="12 9"/>`
    const inner = { x: slot.x + 24, y: slot.y + 24, w: slot.w - 48, h: slot.h - 48 }
    if (art?.ill) svg += illustrationEl(art.ill, inner, sh.pal, { vignette: false }).svg
    else if (art) {
      const side = Math.min(inner.w, inner.h) * 0.8
      svg += motifBlock(sh.motifName, inner.x + (inner.w - side) / 2, inner.y + (inner.h - side) / 2, side, side, sh.pal)
    }
    const boxes = [{ kind: 'art', ...slot }]
    if (tb) {
      const out = tb.render(CONTENT.left + 20, tasksTop)
      svg += out.svg
      boxes.push(...out.boxes)
    }
    return { svg: pageDoc(sh.svg, svg), boxes: [...sh.boxes, ...boxes], meta: { size: s || null, art: art?.ill ? 'full' : art ? 'motif' : 'none' } }
  }
  throw new LayoutOverflowError('activity tasks leave too little room for the picture')
}
