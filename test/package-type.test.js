import { describe, it, expect } from 'vitest'
import { resolvePackageType, getPackageType } from '../src/lib/package-type.js'

describe('resolvePackageType', () => {
  it('returns free when day matches freeDay', () => {
    expect(resolvePackageType({ day: 0, freeDay: 0 })).toBe('free')
  })

  it('returns large when day matches largeDay', () => {
    expect(resolvePackageType({ day: 3, freeDay: 0, largeDay: 3 })).toBe('large')
  })

  it('returns small on any other day', () => {
    expect(resolvePackageType({ day: 2, freeDay: 0, largeDay: 5 })).toBe('small')
  })

  it('gives free priority when free and large land on the same day', () => {
    expect(resolvePackageType({ day: 4, freeDay: 4, largeDay: 4 })).toBe('free')
  })

  it('disables large when largeDay is omitted (default -1)', () => {
    expect(resolvePackageType({ day: 3, freeDay: 0 })).toBe('small')
  })
})

describe('getPackageType (env + date injection)', () => {
  it('reads FREE_WORKSHEET_DAY default of 0 (Sunday)', () => {
    const sunday = new Date('2026-06-14T00:00:00Z') // Sunday
    expect(getPackageType(sunday, {})).toBe('free')
  })

  it('honors a configured large day', () => {
    const wed = new Date('2026-06-10T12:00:00') // Wednesday, local
    expect(getPackageType(wed, { FREE_WORKSHEET_DAY: '0', LARGE_PACKAGE_DAY: String(wed.getDay()) })).toBe('large')
  })

  it('falls back to small when nothing matches', () => {
    const tue = new Date('2026-06-09T12:00:00') // Tuesday, local
    expect(getPackageType(tue, { FREE_WORKSHEET_DAY: '0' })).toBe('small')
  })
})
