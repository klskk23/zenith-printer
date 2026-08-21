import { describe, expect, it } from 'vitest'
import { DEFAULT_DPI, dotsToMm, layoutGrid, mmToDots, snapToDotGrid } from '../src/units.ts'

describe('mmToDots', () => {
  it('rounds rather than truncating', () => {
    // 50 * 203 / 25.4 = 399.6 -> round gives 400, floor would give 399.
    // The constitution mandates round; a one-dot error accumulates across a layout.
    expect(mmToDots(50, 203)).toBe(400)
    expect(mmToDots(30, 203)).toBe(240)
  })

  it('matches the verified 50x30mm sample used on B3S_P', () => {
    expect(mmToDots(50, 203)).toBe(400)
    expect(mmToDots(30, 203)).toBe(240)
  })

  it('handles the 300 dpi variant', () => {
    expect(mmToDots(50, 300)).toBe(591)
  })

  it('rejects a non-positive dpi', () => {
    expect(() => mmToDots(50, 0)).toThrow(/dpi/i)
    expect(() => mmToDots(50, -203)).toThrow(/dpi/i)
  })

  it('rejects a non-finite millimetre value', () => {
    expect(() => mmToDots(Number.NaN, 203)).toThrow(/finite/i)
  })
})

describe('dotsToMm', () => {
  it('round-trips within one dot', () => {
    const dots = mmToDots(50, 203)
    expect(Math.abs(dotsToMm(dots, 203) - 50)).toBeLessThan(dotsToMm(1, 203))
  })
})

describe('snapToDotGrid', () => {
  it('aligns a coordinate onto a whole dot', () => {
    // A horizontal rule that lands between two pixel rows is smeared across
    // both by anti-aliasing and then thresholded away.
    expect(snapToDotGrid(10.3, 203)).toBe(dotsToMm(mmToDots(10.3, 203), 203))
  })

  it('is idempotent', () => {
    const once = snapToDotGrid(7.77, 203)
    expect(snapToDotGrid(once, 203)).toBeCloseTo(once, 10)
  })
})

describe('layoutGrid', () => {
  it('derives the canvas size once and places elements on that grid', () => {
    const grid = layoutGrid({ widthMm: 50, heightMm: 30, dpi: 203 })
    expect(grid.widthDots).toBe(400)
    expect(grid.heightDots).toBe(240)
  })

  it('does not accumulate error across elements near the right edge', () => {
    // Converting each element independently from millimetres lets rounding
    // error pile up; positions must be derived from the integer dot canvas.
    const grid = layoutGrid({ widthMm: 50, heightMm: 30, dpi: 203 })
    const naive = Array.from({ length: 10 }, (_, i) => mmToDots(5 * (i + 1), 203))
    const viaGrid = Array.from({ length: 10 }, (_, i) => grid.xToDots(5 * (i + 1)))

    // The last element must sit exactly on the canvas edge, not one to three
    // dots short of it.
    expect(viaGrid.at(-1)).toBe(grid.widthDots)
    expect(naive.at(-1)).toBe(400)
  })

  it('clamps a coordinate that falls outside the canvas', () => {
    const grid = layoutGrid({ widthMm: 50, heightMm: 30, dpi: 203 })
    expect(grid.xToDots(-5)).toBe(0)
    expect(grid.xToDots(999)).toBe(grid.widthDots)
  })

  it('reports the smallest imageable stroke width', () => {
    const grid = layoutGrid({ widthMm: 50, heightMm: 30, dpi: 203 })
    // 1 dot at 203 dpi is 0.125 mm; anything thinner disappears after
    // thresholding, so the schema refuses it (FR-008).
    expect(grid.minStrokeWidthMm).toBeCloseTo(25.4 / 203, 6)
  })
})

describe('DEFAULT_DPI', () => {
  it('matches the probed B3S_P metadata', () => {
    expect(DEFAULT_DPI).toBe(203)
  })
})
