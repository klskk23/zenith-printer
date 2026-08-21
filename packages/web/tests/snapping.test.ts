/**
 * Snapping.
 *
 * The property that matters: a snapped position lands on a whole dot, because
 * that is the only grid the print head has. Sub-dot placement is not "more
 * precise" — it is smeared by anti-aliasing and then partly erased by
 * thresholding.
 */
import { describe, expect, it } from 'vitest'
import { mmToDots } from '@zenith/shared'
import { gridFor, isSnapBypassed, snapLengthMm, snapPointMm } from '../src/editor/snapping.ts'

const IR = { widthMm: 50, heightMm: 30, dpi: 203 }
const grid = gridFor(IR)

const isWholeDot = (mm: number): boolean =>
  Math.abs(mmToDots(mm, IR.dpi) - Math.round(mmToDots(mm, IR.dpi))) < 1e-9

describe('snapLengthMm', () => {
  it.each([0, 1.234, 7.77, 12.5, 49.9])('puts %f mm on a whole dot', (mm) => {
    expect(isWholeDot(snapLengthMm(mm, { grid }))).toBe(true)
  })

  it('leaves a value already on the grid alone', () => {
    const onGrid = snapLengthMm(10, { grid })
    expect(snapLengthMm(onGrid, { grid })).toBeCloseTo(onGrid, 10)
  })

  it('moves by less than half a dot', () => {
    const before = 7.77
    const after = snapLengthMm(before, { grid })
    const halfDotMm = 25.4 / IR.dpi / 2
    expect(Math.abs(after - before)).toBeLessThanOrEqual(halfDotMm + 1e-9)
  })

  it('uses the canvas dpi, not a fixed one', () => {
    const coarse = gridFor({ ...IR, dpi: 100 })
    expect(snapLengthMm(1.234, { grid: coarse })).not.toBeCloseTo(snapLengthMm(1.234, { grid }), 6)
  })
})

describe('snapPointMm', () => {
  it('snaps both axes', () => {
    const snapped = snapPointMm({ xMm: 3.33, yMm: 8.88 }, { grid })
    expect(isWholeDot(snapped.xMm)).toBe(true)
    expect(isWholeDot(snapped.yMm)).toBe(true)
  })

  it('treats both axes with the same grid', () => {
    // A single dot grid, not one per axis: an element nudged right and an
    // element nudged down must move by the same physical amount.
    const a = snapPointMm({ xMm: 3.33, yMm: 3.33 }, { grid })
    expect(a.xMm).toBeCloseTo(a.yMm, 12)
  })
})

describe('bypass', () => {
  it('returns the exact value when snapping is suspended', () => {
    expect(snapLengthMm(7.77, { grid, bypass: true })).toBe(7.77)
  })

  it('passes the point through untouched', () => {
    const point = { xMm: 3.33, yMm: 8.88 }
    expect(snapPointMm(point, { grid, bypass: true })).toEqual(point)
  })

  it('reads the bypass from the Alt modifier', () => {
    expect(isSnapBypassed({ altKey: true })).toBe(true)
    expect(isSnapBypassed({ altKey: false })).toBe(false)
    expect(isSnapBypassed({})).toBe(false)
  })
})
