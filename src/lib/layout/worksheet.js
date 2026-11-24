// Layout engine for hybrid worksheet/activity pages (PAGE_RENDERER=hybrid).
// Code places every printed element; FLUX only supplies one decorative spot
// illustration. Guarantees (checked by test/layout-engine.test.js):
//   • every text line is wrapped with measured widths, so no line leaves its box;
//   • blocks are stacked in one column and the illustration gets its own rectangle
//     (a band under the questions, or a float at the top right that narrows the
//     rows beside it), so nothing overlaps;
//   • if the content cannot fit even at the minimum font size without the
//     illustration, LayoutOverflowError is thrown (the caller falls back).
// Every layout returns { svg, boxes, meta }: boxes are the drawn rectangles
// (kind: header|decor|name|text|badge|answer|blank|bank|art|bg) for the tests.
import { PAGE_W, PAGE_H } from '../svg-templates.js'
import { measureText, wrapText, wrapTokens, fitText, fitLine, cleanText, LayoutOverflowError } from './measure.js'
import { textEl, palette, themeMotif, motifCluster, motifBlock, numberBadge, answerBox, answerLine, illustrationEl, r1 } from './decor.js'

export const CONTENT = { left: 118, right: 906, bottom: 1474 }
const ASC = 0.93
const DESC = 0.25
const INSTR_TOP = 248
const FLOAT = { w: 270, h: 270, gap: 24, maxLines: 3 }
const ART = { min: 250, minSmall: 170, max: 520, maxW: 700, gap: 26 }
const ART_MIN_FONT = 20

const textBox = (x, baseline, w, s, kind = 'text') => ({ kind, x, y: baseline - ASC * s, w, h: (ASC + DESC) * s })

/** Page title shown in the header ("Worksheet: Addition Facts"). */
export const pageTitle = (page) => cleanText(page.content?.title || page.title || String(page.filename ?? '').replace(/[-_]+/g, ' ')).trim()

// ── Frame: background, card, header band, name/date pill, corner motifs ───────
function frame(plan, page, pal, motifName) {
  const { c, accent, pale } = pal
  const title = fitLine(plan.setTitle ?? '', { width: 820, max: 42, min: 22, bold: true })
  const kind = page.type === 'activity' ? 'Activity' : 'Worksheet'
  const pt = pageTitle(page)
  const sub = fitLine([plan.gradeLevel, pt ? `${kind}: ${pt}` : kind].filter(Boolean).join(' | '), { width: 860, max: 26, min: 16, bold: true })
  const tw = measureText(title.text, title.size, { bold: true })
  const sw = measureText(sub.text, sub.size, { bold: true })
  const boxes = [
    textBox(PAGE_W / 2 - tw / 2, 76, tw, title.size, 'header'),
    textBox(PAGE_W / 2 - sw / 2, 122, sw, sub.size, 'header'),
    { kind: 'name', x: CONTENT.left, y: 166, w: CONTENT.right - CONTENT.left, h: 56 },
    { kind: 'decor', x: 26, y: 150, w: 86, h: 86 },
    { kind: 'decor', x: PAGE_W - 112, y: 150, w: 86, h: 86 },
    { kind: 'decor', x: 26, y: PAGE_H - 112, w: 86, h: 86 },
    { kind: 'decor', x: PAGE_W - 112, y: PAGE_H - 112, w: 86, h: 86 },
  ]
  const svg = `<rect width="100%" height="100%" fill="${pal.soft}"/>
<rect x="16" y="16" width="${PAGE_W - 32}" height="${PAGE_H - 32}" rx="34" fill="#fff"/>
<path d="M16 50 Q16 16 50 16 H${PAGE_W - 50} Q${PAGE_W - 16} 16 ${PAGE_W - 16} 50 V146 H16 Z" fill="${c}"/>
<path d="M16 146 Q${PAGE_W / 4} 132 ${PAGE_W / 2} 146 T${PAGE_W - 16} 146" fill="none" stroke="${accent}" stroke-width="4" opacity=".7"/>
<rect x="16" y="16" width="${PAGE_W - 32}" height="${PAGE_H - 32}" rx="34" fill="none" stroke="${c}" stroke-width="10"/>
<rect x="32" y="158" width="${PAGE_W - 64}" height="${PAGE_H - 190}" rx="22" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>
${textEl(PAGE_W / 2, 76, title.text, { size: title.size, weight: 'bold', fill: '#fff', anchor: 'middle' })}
${textEl(PAGE_W / 2, 122, sub.text, { size: sub.size, weight: 'bold', fill: '#fff', anchor: 'middle' })}
<rect x="${CONTENT.left}" y="166" width="${CONTENT.right - CONTENT.left}" height="56" rx="28" fill="${pale}"/>
${textEl(CONTENT.left + 26, 203, 'Name:', { size: 25, weight: 'bold', fill: c })}
${answerLine(CONTENT.left + 120, CONTENT.left + 470, 206, c)}
${textEl(CONTENT.left + 500, 203, 'Date:', { size: 25, weight: 'bold', fill: c })}
${answerLine(CONTENT.left + 585, CONTENT.right - 28, 206, c)}
${motifCluster(motifName, 26, 150, 86, 86, pal)}
${motifCluster(motifName, PAGE_W - 112, 150, 86, 86, pal, true)}
${motifCluster(motifName, 26, PAGE_H - 112, 86, 86, pal)}
${motifCluster(motifName, PAGE_W - 112, PAGE_H - 112, 86, 86, pal, true)}`
  return { svg, boxes }
}

/** Instruction line(s) under the name pill; returns the y where content starts. */
function instruction(textStr) {
  const width = CONTENT.right - CONTENT.left
  const { size, lines } = fitText(textStr, { width, maxLines: 2, max: 26, min: 16, italic: true })
  const lh = size * 1.3
  const boxes = []
  const svg = lines.map((l, i) => {
    const base = INSTR_TOP + size + i * lh
    boxes.push(textBox(CONTENT.left, base, measureText(l, size, { italic: true }), size))
    return textEl(CONTENT.left, base, l, { size, fill: '#444', style: 'italic' })
  }).join('')
  return { svg, boxes, bottom: INSTR_TOP + size + (lines.length - 1) * lh + DESC * size + 26 }
}

// ── Answer-space helpers ──────────────────────────────────────────────────────
const words = (s) => cleanText(s).trim().split(/\s+/).filter(Boolean)
/** A short answer (number, word, short phrase) gets a box beside the question. Pure. */
export const isShortAnswer = (answer) => { const a = cleanText(answer).trim(); return a.length <= 14 && words(a).length <= 3 }
/** Writing lines under a question, from the expected answer length. Pure. */
export const answerLineCount = (answer) => { const n = cleanText(answer).trim().length; return n <= 45 ? 1 : n <= 110 ? 2 : 3 }

// ── Blocks: build(width) → { h, render(x, y) → { svg, boxes } } | null ────────
function questionRow(q, s, pal, index) {
  return {
    build(width) {
      const padX = s * 0.45
      const padY = s * 0.38
      const r = s * 0.95
      const tx = 2 * r + s * 0.55
      const inner = width - 2 * padX
      const lh = s * 1.3
      const boxW = Math.max(130, s * 5.2)
      const boxH = s * 1.9
      let textW = inner - tx
      let mode = 'lines'
      if (isShortAnswer(q.answer) && inner - tx - boxW - s * 0.7 >= s * 7) { textW = inner - tx - boxW - s * 0.7; mode = 'box' }
      if (textW < s * 5) return null
      const lines = wrapText(q.question, textW, s, { bold: true })
      const firstBase = r + s * 0.36 // relative to content top: text centred on the badge
      const textBottom = firstBase + (lines.length - 1) * lh + DESC * s
      let contentH = Math.max(textBottom, 2 * r)
      const nLines = mode === 'lines' ? answerLineCount(q.answer) : 0
      if (mode === 'box') contentH = Math.max(contentH, boxH)
      else contentH += nLines * s * 1.85
      const h = contentH + 2 * padY
      return {
        h,
        lines: lines.length,
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
          if (mode === 'box') {
            const bx = x + width - padX - boxW
            svg += answerBox(bx, top, boxW, boxH, pal.c)
            boxes.push({ kind: 'answer', x: bx, y: top, w: boxW, h: boxH })
          } else {
            const startY = top + Math.max(textBottom, 2 * r)
            for (let i = 1; i <= nLines; i++) {
              const ly = startY + i * s * 1.85 - s * 0.2
              svg += answerLine(left + tx, x + width - padX, ly)
              boxes.push({ kind: 'answer', x: left + tx, y: ly - 2, w: x + width - padX - left - tx, h: 4 })
            }
          }
          return { svg, boxes }
        },
      }
    },
  }
}

const BLANK_RE = /_{2,}/g
/** Sentence tokens: words and `{ blank }` markers; "(blank 3)" references are dropped. Pure. */
export function sentenceTokens(sentence, blankW) {
  const clean = cleanText(sentence).replace(/\s*\(\s*blank\s*\d+\s*\)/gi, '')
  const parts = clean.split(BLANK_RE)
  const tokens = []
  parts.forEach((p, i) => {
    tokens.push(...words(p))
    if (i < parts.length - 1) tokens.push({ blank: blankW })
  })
  if (parts.length === 1) tokens.push({ blank: blankW })
  return tokens
}

function sentenceRow(q, s, pal, index, bankWords) {
  return {
    build(width) {
      const padX = s * 0.45
      const padY = s * 0.45
      const r = s * 0.95
      const tx = 2 * r + s * 0.55
      const textW = width - 2 * padX - tx
      const longest = Math.max(0, ...bankWords.map(w => measureText(w, s)))
      const blankW = Math.min(textW, Math.max(s * 5, Math.min(textW * 0.45, longest + s * 1.2)))
      if (textW < s * 6) return null
      const lines = wrapTokens(sentenceTokens(q.question, blankW), textW, s)
      const lh = s * 1.75
      const firstBase = r + s * 0.36
      const h = Math.max(firstBase + (lines.length - 1) * lh + DESC * s + s * 0.2, 2 * r) + 2 * padY
      return {
        h,
        lines: lines.length,
        render(x, y) {
          const top = y + padY
          const left = x + padX
          const boxes = [{ kind: 'bg', x, y, w: width, h }]
          let svg = index % 2 === 0 ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" rx="${r1(s * 0.6)}" fill="${pal.pale}"/>` : ''
          svg += numberBadge(left + r, top + r, r, q.num, pal.c)
          boxes.push({ kind: 'badge', x: left, y: top, w: 2 * r, h: 2 * r })
          lines.forEach((line, i) => {
            const base = top + firstBase + i * lh
            let run = []
            const flush = () => {
              if (!run.length) return
              const t = run.map(tk => tk.text).join(' ')
              const rx = left + tx + run[0].x
              svg += textEl(rx, base, t, { size: s, fill: '#222' })
              boxes.push(textBox(rx, base, measureText(t, s), s))
              run = []
            }
            for (const tk of line) {
              if (!tk.blank) { run.push(tk); continue }
              flush()
              const bx = left + tx + tk.x
              svg += answerLine(bx, bx + tk.w, base + s * 0.12, pal.c)
              boxes.push({ kind: 'blank', x: bx, y: base - ASC * s, w: tk.w, h: (ASC + DESC) * s })
            }
            flush()
          })
          return { svg, boxes }
        },
      }
    },
  }
}

function wordBankBlock(bank, s, pal) {
  return {
    build(width) {
      const ps = Math.min(s, 30)
      const pillH = ps * 1.8
      const gapX = ps * 0.7
      const gapY = ps * 0.55
      const pad = ps * 0.8
      const inner = width - 2 * pad
      const pills = bank.map(w => ({ w: measureText(w, ps, { bold: true }) + ps * 1.4, text: w }))
      if (pills.some(p => p.w > inner)) return null
      const rows = []
      let row = []
      let rw = 0
      for (const p of pills) {
        if (row.length && rw + gapX + p.w > inner) { rows.push({ row, rw }); row = []; rw = 0 }
        rw += (row.length ? gapX : 0) + p.w
        row.push(p)
      }
      if (row.length) rows.push({ row, rw })
      const labelS = ps * 0.9
      const h = pad + labelS * 1.2 + gapY + rows.length * pillH + (rows.length - 1) * gapY + pad
      return {
        h,
        render(x, y) {
          let svg = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(h)}" rx="${r1(ps * 0.8)}" fill="${pal.pale}" stroke="${pal.accent}" stroke-width="3" stroke-dasharray="10 8"/>`
          const boxes = [{ kind: 'bank', x, y, w: width, h }]
          svg += textEl(x + width / 2, y + pad + labelS * 0.9, 'Word Bank', { size: labelS, weight: 'bold', fill: pal.c, anchor: 'middle' })
          let py = y + pad + labelS * 1.2 + gapY
          for (const { row: rr, rw: w } of rows) {
            let px = x + (width - w) / 2
            for (const p of rr) {
              svg += `<rect x="${r1(px)}" y="${r1(py)}" width="${r1(p.w)}" height="${r1(pillH)}" rx="${r1(pillH / 2)}" fill="#fff" stroke="${pal.c}" stroke-width="3"/>`
              svg += textEl(px + p.w / 2, py + pillH / 2 + ps * 0.36, p.text, { size: ps, weight: 'bold', fill: '#222', anchor: 'middle' })
              px += p.w + gapX
            }
            py += pillH + gapY
          }
          return { svg, boxes }
        },
      }
    },
  }
}

// ── Flow + composition ────────────────────────────────────────────────────────
/**
 * Stack blocks top-down. With `floatSize`, a w×h rectangle is reserved at the
 * right edge starting at the first floatable block; blocks that start beside it
 * get the narrower width. Returns null if any block cannot be built or the
 * column (or the float) runs past `bottom`.
 */
function flow(blocks, { top, bottom, left, right, floatSize, gap }) {
  let y = top
  let float = null
  const placed = []
  for (const b of blocks) {
    if (floatSize && !float && b.floatable !== false) float = { x: right - floatSize.w, y, w: floatSize.w, h: floatSize.h }
    const narrow = float && y < float.y + float.h + gap
    const width = narrow ? float.x - FLOAT.gap - left : right - left
    const built = b.build(width)
    // A row squeezed into many short lines beside the float looks worse than no float.
    if (!built || (narrow && built.lines > FLOAT.maxLines)) return null
    placed.push({ y, width, built })
    y += built.h + gap
  }
  const end = placed.length ? y - gap : top
  if (floatSize && (!float || float.y + float.h > bottom)) return null
  return end <= bottom ? { placed, end, float } : null
}

/**
 * Try font sizes from large to small; at each size prefer the illustration in a
 * band under the content, then as a top-right float; finally drop it.
 * `art` is { kind: 'image', ill } | { kind: 'motif', name } | null.
 */
function compose({ top, blocksFor, sizes, art, pal, rowGap = 0.45 }) {
  const area = { left: CONTENT.left, right: CONTENT.right, top, bottom: CONTENT.bottom }
  const attempts = []
  if (art) for (const size of sizes.filter(s => s >= ART_MIN_FONT)) attempts.push({ size, mode: 'band', min: ART.min }, { size, mode: 'float' }, { size, mode: 'band', min: ART.minSmall })
  for (const size of sizes) attempts.push({ size, mode: 'none' })

  for (const a of attempts) {
    const blocks = blocksFor(a.size)
    const gap = a.size * rowGap
    const res = flow(blocks, { ...area, floatSize: a.mode === 'float' ? FLOAT : null, gap })
    if (!res) continue
    const leftover = area.bottom - res.end
    if (a.mode === 'band' && leftover < a.min + ART.gap) continue

    // Spread spare height into the gaps (capped) so the page never looks top-heavy.
    const n = res.placed.length
    let spare = leftover
    if (a.mode === 'band') spare = Math.max(0, leftover - ART.gap - ART.max)
    if (a.mode === 'float') spare = Math.max(0, area.bottom - Math.max(res.end, res.float.y + res.float.h))
    const extra = n > 1 ? Math.min(spare / n, a.size * (a.mode === 'band' ? 0.7 : 0.9)) : 0
    let svg = ''
    const boxes = []
    res.placed.forEach((p, i) => {
      const out = p.built.render(area.left, p.y + i * extra)
      svg += out.svg
      boxes.push(...out.boxes)
    })
    const end = res.end + (n - 1) * extra

    let slot = null
    if (a.mode === 'band') {
      const avail = area.bottom - end - ART.gap
      const h = Math.min(avail, ART.max)
      const w = Math.min(area.right - area.left, ART.maxW)
      slot = { x: area.left + (area.right - area.left - w) / 2, y: end + ART.gap + (avail - h) / 2, w, h }
    } else if (a.mode === 'float') {
      // Rows start beside the float may shift down by `extra` each; the float moves
      // with the first floatable row so it stays aligned to it.
      const firstIdx = res.placed.findIndex(p => p.y === res.float.y)
      slot = { ...res.float, y: res.float.y + Math.max(0, firstIdx) * extra }
    }

    if (slot) {
      boxes.push({ kind: 'art', ...slot })
      if (art.kind === 'image') svg += illustrationEl(art.ill, slot, pal).svg
      else {
        const side = Math.min(slot.w, slot.h)
        svg += motifBlock(art.name, slot.x + (slot.w - side) / 2, slot.y + (slot.h - side) / 2, side, side, pal)
      }
    }
    return { svg, boxes, meta: { size: a.size, art: slot ? a.mode : (art ? 'dropped' : 'none') } }
  }
  throw new LayoutOverflowError(`content does not fit the page even at ${sizes[sizes.length - 1]}px without an illustration`)
}

const SIZES = [32, 30, 28, 26, 24, 22, 20, 18, 16]

function page(plan, pg, { art, instructionText, blocksFor }) {
  const pal = palette(plan.themeColor)
  const motifName = themeMotif(plan)
  const fr = frame(plan, pg, pal, motifName)
  const ins = instruction(instructionText)
  const artSpec = art?.ill ? { kind: 'image', ill: art.ill } : art ? { kind: 'motif', name: motifName } : null
  const body = compose({ top: ins.bottom, blocksFor: (s) => blocksFor(s, pal), sizes: SIZES, art: artSpec, pal })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
${fr.svg}
${ins.svg}
${body.svg}
</svg>`
  return { svg, boxes: [...fr.boxes, ...ins.boxes, ...body.boxes], meta: body.meta }
}

/**
 * `questions` layout: numbered questions, each with an answer box (short answers)
 * or writing lines (longer answers), plus one illustration spot.
 * @param {{ ill?: { href, width, height } } | true | null} art  prepared illustration,
 *   `true` for the decorative SVG fallback block, or null for none.
 */
export function questionsPageSvg(plan, pg, { art = null } = {}) {
  const qs = pg.content.questions
  const allShort = qs.every(q => isShortAnswer(q.answer))
  return page(plan, pg, {
    art,
    instructionText: allShort ? 'Read each question carefully. Write your answer in the box.' : 'Read each question carefully. Write your answer on the lines.',
    blocksFor: (s, pal) => qs.map((q, i) => questionRow(q, s, pal, i)),
  })
}

/**
 * `fill_blank` layout: word bank at the top, then numbered sentences with inline
 * blanks (a sentence without "___" gets a blank at the end), plus one spot.
 */
export function fillBlankPageSvg(plan, pg, { art = null, wordBank = [] } = {}) {
  const qs = pg.content.questions
  const bank = wordBank.map(w => cleanText(w).trim()).filter(Boolean)
  return page(plan, pg, {
    art,
    instructionText: bank.length ? 'Use the words in the word bank to complete each sentence.' : 'Complete each sentence. Write the missing word on the line.',
    blocksFor: (s, pal) => [
      ...(bank.length ? [{ ...wordBankBlock(bank, s, pal), floatable: false }] : []),
      ...qs.map((q, i) => sentenceRow(q, s, pal, i, bank)),
    ],
  })
}
