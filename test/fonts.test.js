import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { FONT_DIR, FONT_FILES, parseTtf, configureFonts } from '../src/lib/fonts.js'
import { renderSvg } from '../src/lib/svg-templates.js'
import { measureText } from '../src/lib/layout/measure.js'
import { diffGolden } from './helpers/golden.js'

const line = (s, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="110"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="78" font-family="Nunito" font-size="56" ${attrs}>${s}</text></svg>`

describe('bundled font', () => {
  it('ships regular/bold/italic Nunito with its OFL licence and a fontconfig file', () => {
    for (const f of [...Object.values(FONT_FILES), 'OFL.txt', 'fonts.conf']) expect(readFileSync(path.join(FONT_DIR, f)).length).toBeGreaterThan(0)
    expect(readFileSync(path.join(FONT_DIR, 'OFL.txt'), 'utf8')).toMatch(/SIL Open Font License/)
  })

  it('points fontconfig/Pango at the bundled fonts without overriding an explicit setting', () => {
    const env = {}
    configureFonts(env)
    expect(env.FONTCONFIG_FILE).toBe(path.join(FONT_DIR, 'fonts.conf'))
    expect(env.PANGOCAIRO_BACKEND).toBe('fc')
    const own = { FONTCONFIG_FILE: '/x/fonts.conf', PANGOCAIRO_BACKEND: 'coretext' }
    configureFonts(own)
    expect(own).toEqual({ FONTCONFIG_FILE: '/x/fonts.conf', PANGOCAIRO_BACKEND: 'coretext' })
  })

  it('reads real advance widths from the TTF (Nunito: 1000 units/em, i narrower than W, bold wider)', () => {
    const reg = parseTtf(readFileSync(path.join(FONT_DIR, FONT_FILES.regular)))
    const bold = parseTtf(readFileSync(path.join(FONT_DIR, FONT_FILES.bold)))
    expect(reg.unitsPerEm).toBe(1000)
    expect(reg.advance('i'.codePointAt(0))).toBeLessThan(reg.advance('W'.codePointAt(0)))
    expect(bold.advance('a'.codePointAt(0))).toBeGreaterThan(reg.advance('a'.codePointAt(0)))
    expect(reg.advance('ก'.codePointAt(0))).toBeUndefined() // Thai comes from a fallback font
  })

  // A render that falls back to another font (Helvetica, DejaVu) fails both checks:
  // the glyph shapes differ from the golden and the ink widths stop matching the metrics.
  it('renders SVG text with the bundled Nunito (golden glyph shapes)', async () => {
    const png = await renderSvg(line('Agy Rag 0123 &amp; quick', 'font-weight="bold"'))
    const d = await diffGolden(png, 'font-nunito-bold', { width: 700 })
    expect(d.changed).toBeLessThan(0.01)
  })

  it('measured widths match the rendered ink width (never narrower, ≤ 8% wider)', async () => {
    for (const [s, opts, attrs] of [
      ['The quick brown fox jumps over the lazy dog.', {}, ''],
      ['Multiplication Word Problems 7 + 5 = 12', { bold: true }, 'font-weight="bold"'],
      ['Read each question carefully.', { italic: true }, 'font-style="italic"'],
    ]) {
      const { info } = await sharp(await renderSvg(line(s, attrs))).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true })
      const ratio = measureText(s, 56, opts) / info.width
      expect(ratio).toBeGreaterThanOrEqual(1)
      expect(ratio).toBeLessThan(1.08)
    }
  })
})
