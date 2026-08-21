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
import { SNAP_STEP_MM, gridFor, isSnapBypassed, snapLengthMm, snapPointMm } from '../src/editor/snapping.ts'

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

  it('moves by no more than half a step', () => {
    const before = 7.77
    const after = snapLengthMm(before, { grid })
    const halfDotMm = 25.4 / IR.dpi / 2
    expect(Math.abs(after - before)).toBeLessThanOrEqual(SNAP_STEP_MM / 2 + halfDotMm + 1e-9)
  })

  /**
   * The defect this file used to certify as correct.
   *
   * Every assertion here passed against a version that rounded to whole dots
   * and nothing else — 7.77 mm became 7.7695 mm, which is not a grid anyone
   * can aim at. Naming the visible step is what makes the difference testable.
   */
  it('lands on the visible step, not merely on a dot', () => {
    expect(snapLengthMm(7.77, { grid })).toBeCloseTo(8, 1)
    expect(snapLengthMm(7.2, { grid })).toBeCloseTo(7, 1)
    expect(snapLengthMm(0.4, { grid })).toBeCloseTo(0, 1)
  })

  it('honours a step the caller chooses', () => {
    expect(snapLengthMm(7.77, { grid, stepMm: 5 })).toBeCloseTo(10, 1)
    expect(snapLengthMm(7.4, { grid, stepMm: 0.5 })).toBeCloseTo(7.5, 1)
  })

  it('falls back to the dot grid when the step is zero', () => {
    // Guards a division by zero that would otherwise produce NaN and blank the
    // element rather than fail loudly.
    expect(isWholeDot(snapLengthMm(7.77, { grid, stepMm: 0 }))).toBe(true)
  })

  it('uses the canvas dpi, not a fixed one', () => {
    // At a sub-millimetre step the two dot grids disagree; at the default step
    // they would round to the same millimetre and the check would say nothing.
    const coarse = gridFor({ ...IR, dpi: 100 })
    expect(snapLengthMm(1.234, { grid: coarse, stepMm: 0.1 })).not.toBeCloseTo(
      snapLengthMm(1.234, { grid, stepMm: 0.1 }),
      6,
    )
  })
})

describe('snapPointMm', () => {
  it('snaps both axes', () => {
    const snapped = snapPointMm({ xMm: 3.33, yMm: 8.88 }, { grid })
    expect(isWholeDot(snapped.xMm)).toBe(true)
    expect(isWholeDot(snapped.yMm)).toBe(true)
    expect(snapped.xMm).toBeCloseTo(3, 1)
    expect(snapped.yMm).toBeCloseTo(9, 1)
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
