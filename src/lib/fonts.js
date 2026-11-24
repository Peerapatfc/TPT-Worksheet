// Bundled font for every code-rendered page (answer keys, chart pages, covers,
// hybrid layouts). sharp renders SVG with librsvg → Pango; Pango picks fonts
// through fontconfig. To make output identical on the CI Ubuntu runner and on a
// Mac (whose Pango defaults to CoreText and ignores fontconfig), this module sets
// — before the first render, i.e. at import —
//   FONTCONFIG_FILE    → assets/fonts/fonts.conf (bundled dir first, system dirs as glyph fallback)
//   PANGOCAIRO_BACKEND → fc (fontconfig; already the default on Linux)
// and reads real advance widths from the bundled TTFs so text can be measured
// exactly (src/lib/layout/measure.js). Nunito is SIL OFL 1.1 (assets/fonts/OFL.txt).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts')
export const FONT_FAMILY = 'Nunito'
/** font-family attribute value for every <text>; Pango still falls back per glyph (Thai, emoji). */
export const FONT_STACK = 'Nunito, sans-serif'
export const FONT_FILES = { regular: 'Nunito-Regular.ttf', bold: 'Nunito-Bold.ttf', italic: 'Nunito-Italic.ttf' }

/**
 * Point fontconfig/Pango at the bundled fonts. Must run before the first text
 * render in the process (fontconfig reads the env once). Leaves an explicitly set
 * FONTCONFIG_FILE / PANGOCAIRO_BACKEND alone. Idempotent.
 */
export function configureFonts(env = process.env) {
  if (!env.FONTCONFIG_FILE) env.FONTCONFIG_FILE = path.join(FONT_DIR, 'fonts.conf')
  if (!env.PANGOCAIRO_BACKEND) env.PANGOCAIRO_BACKEND = 'fc'
}
configureFonts()

// ── Minimal TrueType reader: head (unitsPerEm), hhea + hmtx (advances), cmap 4/12 ─
/**
 * Parse a TTF buffer into { unitsPerEm, advance(codePoint) → units | undefined }.
 * Only what text measurement needs; no kerning (Nunito's kerning is almost all
 * negative, so unkerned widths err wide). Pure — exported for unit testing.
 */
export function parseTtf(buf) {
  const u16 = (o) => buf.readUInt16BE(o)
  const u32 = (o) => buf.readUInt32BE(o)
  const tables = {}
  const n = u16(4)
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16
    tables[buf.toString('latin1', rec, rec + 4)] = u32(rec + 8)
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap']) if (tables[t] === undefined) throw new Error(`font has no ${t} table`)
  const unitsPerEm = u16(tables.head + 18)
  const numHMetrics = u16(tables.hhea + 34)
  const glyphAdvance = (g) => u16(tables.hmtx + 4 * Math.min(g, numHMetrics - 1))

  // Prefer a full-Unicode subtable (3,10 format 12), else BMP (3,1 / 0,x format 4).
  const cmap = tables.cmap
  let sub4 = null
  let sub12 = null
  for (let i = 0; i < u16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8
    const off = cmap + u32(rec + 4)
    const fmt = u16(off)
    if (fmt === 12) sub12 ??= off
    if (fmt === 4) sub4 ??= off
  }
  const cmapMap = new Map()
  if (sub12 !== null) {
    const groups = u32(sub12 + 12)
    for (let i = 0; i < groups; i++) {
      const g = sub12 + 16 + i * 12
      const start = u32(g)
      const end = u32(g + 4)
      const gid = u32(g + 8)
      for (let c = start; c <= end; c++) cmapMap.set(c, gid + c - start)
    }
  } else if (sub4 !== null) {
    const segX2 = u16(sub4 + 6)
    const ends = sub4 + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const ranges = deltas + segX2
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(ends + 2 * s)
      const start = u16(starts + 2 * s)
      const delta = u16(deltas + 2 * s)
      const rangeOff = u16(ranges + 2 * s)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid
        if (rangeOff === 0) gid = (c + delta) & 0xffff
        else {
          gid = u16(ranges + 2 * s + rangeOff + 2 * (c - start))
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid !== 0) cmapMap.set(c, gid)
      }
    }
  } else throw new Error('font has no usable cmap subtable')

  const advances = new Map()
  for (const [c, g] of cmapMap) advances.set(c, glyphAdvance(g))
  return { unitsPerEm, advance: (cp) => advances.get(cp) }
}

let metrics = null
/** Parsed metrics of the bundled regular/bold/italic files (loaded once). */
export function fontMetrics() {
  if (!metrics) {
    metrics = Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, parseTtf(readFileSync(path.join(FONT_DIR, f)))]))
  }
  return metrics
}
