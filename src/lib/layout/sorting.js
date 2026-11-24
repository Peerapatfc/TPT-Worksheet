// `sorting` layout: a bank of words (code-shuffled, seeded) and 2–4 category
// columns with writing lines. Every column gets the same number of lines
// (largest category + 1), so the line count gives nothing away. The key lists
// each category's words (layoutAnswerKey). Overflow: shrink, drop art, throw.
import { measureText, wrapText, fitText, cleanText, LayoutOverflowError } from './measure.js'
import { textEl, answerLine, r1 } from './decor.js'
import { page, textBox, wordBankBlock } from './worksheet.js'
import { sortingOrder } from './specs.js'

const norm = (v) => cleanText(v).trim().toLowerCase()

function columnsBlock(categories, lineCount, s, pal) {
  return {
    floatable: false,
    span: true,
    build(width) {
      const k = categories.length
      const gap = s * 0.7
      const colW = (width - (k - 1) * gap) / k
      const hs = Math.min(s, 30)
      let heads
      try {
        heads = categories.map(c => fitText(c, { width: colW - hs * 1.2, maxLines: 2, max: hs, min: Math.min(hs, 16), bold: true }))
      } catch (err) {
        if (err instanceof LayoutOverflowError) return null
        throw err
      }
      const headS = Math.min(...heads.map(h => h.size))
      const headLines = categories.map(c => wrapText(c, colW - hs * 1.2, headS, { bold: true }))
      const headH = Math.max(...headLines.map(l => l.length)) * headS * 1.2 + headS * 0.9
      const lineGap = s * 2.3
      const h = headH + lineCount * lineGap + s * 0.8
      return {
        h,
        render(x, y) {
          let svg = ''
          const boxes = []
          categories.forEach((_, i) => {
            const cx = x + i * (colW + gap)
            svg += `<rect x="${r1(cx)}" y="${r1(y)}" width="${r1(colW)}" height="${r1(h)}" rx="${r1(s * 0.6)}" fill="#fff" stroke="${pal.c}" stroke-width="3"/>`
            svg += `<path d="M${r1(cx)} ${r1(y + s * 0.6)} Q${r1(cx)} ${r1(y)} ${r1(cx + s * 0.6)} ${r1(y)} H${r1(cx + colW - s * 0.6)} Q${r1(cx + colW)} ${r1(y)} ${r1(cx + colW)} ${r1(y + s * 0.6)} V${r1(y + headH)} H${r1(cx)} Z" fill="${pal.c}"/>`
            boxes.push({ kind: 'bg', x: cx, y, w: colW, h })
            const lines = headLines[i]
            const t0 = y + (headH - lines.length * headS * 1.2) / 2 + headS * 0.95
            lines.forEach((l, j) => {
              const w = measureText(l, headS, { bold: true })
              svg += textEl(cx + colW / 2, t0 + j * headS * 1.2, l, { size: headS, weight: 'bold', fill: '#fff', anchor: 'middle' })
              boxes.push(textBox(cx + colW / 2 - w / 2, t0 + j * headS * 1.2, w, headS))
            })
            for (let n = 1; n <= lineCount; n++) {
              const ly = y + headH + n * lineGap
              svg += answerLine(cx + s * 0.6, cx + colW - s * 0.6, ly)
              boxes.push({ kind: 'answer', x: cx + s * 0.6, y: ly - 2, w: colW - s * 1.2, h: 4 })
            }
          })
          return { svg, boxes }
        },
      }
    },
  }
}

/** Sorting page from a validated spec ({ categories, items: [{ word, category }] }). */
export function sortingPageSvg(plan, pg, spec, { art = null } = {}) {
  const order = sortingOrder(spec)
  const words = order.map(i => cleanText(spec.items[i].word).trim())
  const perCat = spec.categories.map(c => spec.items.filter(it => norm(it.category) === norm(c)).length)
  const lineCount = Math.max(...perCat) + 1
  return page(plan, pg, {
    art,
    instructionText: 'Read each word in the box. Write it in the correct column.',
    blocksFor: (s, pal) => [
      { ...wordBankBlock(words, s, pal, { label: 'Words to Sort' }), floatable: false, span: true },
      columnsBlock(spec.categories.map(c => cleanText(c).trim()), lineCount, s, pal),
    ],
    bandOnly: true,
  })
}
