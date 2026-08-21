import { describe, expect, it } from 'vitest'
import { layoutGrid } from '@zenith/shared'
import { hasAnyMargin, marginBands } from '../src/editor/margins.ts'

const grid = layoutGrid({ widthMm: 50, heightMm: 30, dpi: 203 })
const none = { marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 }

describe('marginBands', () => {
  it('draws nothing when every side is zero', () => {
    expect(marginBands(none, grid)).toEqual([])
  })

  it('draws a full-width band for a top margin', () => {
    const [band] = marginBands({ ...none, marginTopMm: 2 }, grid)
    expect(band).toMatchObject({ xDots: 0, yDots: 0, widthDots: grid.widthDots })
    expect(band!.heightDots).toBe(grid.lengthToDots(2))
  })

  it('puts the bottom band against the bottom edge', () => {
    const [band] = marginBands({ ...none, marginBottomMm: 2 }, grid)
    expect(band!.yDots + band!.heightDots).toBe(grid.heightDots)
  })

  it('stops side bands short of the horizontal ones', () => {
    // Overlapping hatching would double up and read as a darker corner, which
    // looks like a stronger prohibition than it is.
    const bands = marginBands({ marginTopMm: 2, marginBottomMm: 2, marginLeftMm: 2, marginRightMm: 0 }, grid)
    const side = bands[bands.length - 1]!
    expect(side.yDots).toBe(grid.lengthToDots(2))
    expect(side.heightDots).toBe(grid.heightDots - grid.lengthToDots(2) * 2)
  })

  it('omits sides that are zero', () => {
    expect(marginBands({ ...none, marginTopMm: 2 }, grid)).toHaveLength(1)
  })

  it('draws all four when all four are set', () => {
    expect(marginBands({ marginTopMm: 1, marginRightMm: 1, marginBottomMm: 1, marginLeftMm: 1 }, grid))
      .toHaveLength(4)
  })

  it('keeps every band inside the canvas', () => {
    for (const band of marginBands({ marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3 }, grid)) {
      expect(band.xDots).toBeGreaterThanOrEqual(0)
      expect(band.yDots).toBeGreaterThanOrEqual(0)
      expect(band.xDots + band.widthDots).toBeLessThanOrEqual(grid.widthDots)
      expect(band.yDots + band.heightDots).toBeLessThanOrEqual(grid.heightDots)
    }
  })
})

describe('hasAnyMargin', () => {
  it('is false for an all-zero profile', () => {
    expect(hasAnyMargin(none)).toBe(false)
  })

  it('is true if any single side is set', () => {
    expect(hasAnyMargin({ ...none, marginLeftMm: 0.5 })).toBe(true)
  })
})
