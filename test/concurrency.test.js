import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../src/lib/concurrency.js'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (v) => {
      await tick(v)
      return v * 2
    })
    expect(out).toEqual([60, 20, 40])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++
      peak = Math.max(peak, active)
      await tick(5)
      active--
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('runs sequentially with limit 1', async () => {
    const order = []
    await mapWithConcurrency([1, 2, 3], 1, async (v) => {
      order.push(`start-${v}`)
      await tick(1)
      order.push(`end-${v}`)
    })
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
  })

  it('clamps a zero/negative limit up to 1', async () => {
    const out = await mapWithConcurrency([1, 2], 0, async (v) => v + 1)
    expect(out).toEqual([2, 3])
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async (v) => v)).toEqual([])
  })
})
