// Shared geometry assertions for layout tests: every drawn box stays on the page /
// in the content column, and no two solid boxes (text, badges, answer space, art,
// figures) overlap. Layouts return their boxes, so this needs no pixels.
import { expect } from 'vitest'
import { CONTENT } from '../../src/lib/layout/worksheet.js'
import { PAGE_W, PAGE_H } from '../../src/lib/svg-templates.js'

// Deterministic PRNG so property failures are reproducible.
export function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

export function overlaps(a, b) {
  const e = 0.5
  return a.x + e < b.x + b.w && b.x + e < a.x + a.w && a.y + e < b.y + b.h && b.y + e < a.y + a.h
}

const CONTENT_KINDS = ['text', 'badge', 'answer', 'blank', 'bank', 'art', 'figure']

export function assertLayout({ boxes }) {
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(PAGE_W)
    expect(b.y + b.h).toBeLessThanOrEqual(PAGE_H)
    if (CONTENT_KINDS.includes(b.kind)) {
      expect(b.x).toBeGreaterThanOrEqual(CONTENT.left - 0.5)
      expect(b.x + b.w).toBeLessThanOrEqual(CONTENT.right + 0.5)
      expect(b.y + b.h).toBeLessThanOrEqual(CONTENT.bottom + 0.5)
    }
  }
  const solid = boxes.filter(b => b.kind !== 'bg')
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i], solid[j])) throw new Error(`overlap: ${JSON.stringify(solid[i])} × ${JSON.stringify(solid[j])}`)
    }
  }
  // Background panels never overlap each other or the illustration.
  const panels = boxes.filter(b => b.kind === 'bg' || b.kind === 'art' || b.kind === 'bank')
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    if (overlaps(panels[i], panels[j])) throw new Error(`panel overlap: ${JSON.stringify(panels[i])} × ${JSON.stringify(panels[j])}`)
  }
}
