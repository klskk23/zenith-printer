/**
 * Rotation-aware bounds.
 *
 * Lives in the shared package because two places need the same answer: the
 * editor's live overflow hint and the pre-print check on every label. Two
 * implementations would eventually disagree, and the disagreement would read as
 * "the editor said it was fine but printing says it overflows".
 */
import { describe, expect, it } from 'vitest'
import { rotatedBounds } from '../src/geometry/index.ts'

const box = { xMm: 10, yMm: 20, widthMm: 30, heightMm: 10 }

describe('rotatedBounds', () => {
  it.each([0, 180] as const)('keeps width and height at %i degrees', (rotation) => {
    expect(rotatedBounds({ ...box, rotation })).toEqual(box)
  })

  it.each([90, 270] as const)('swaps width and height at %i degrees', (rotation) => {
    const bounds = rotatedBounds({ ...box, rotation })
    expect(bounds.widthMm).toBe(10)
    expect(bounds.heightMm).toBe(30)
  })

  it('rotates about the centre, so the centre does not move', () => {
    const centre = (b: { xMm: number; yMm: number; widthMm: number; heightMm: number }) => ({
      x: b.xMm + b.widthMm / 2,
      y: b.yMm + b.heightMm / 2,
    })
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(centre(rotatedBounds({ ...box, rotation }))).toEqual(centre(box))
    }
  })

  it('places the top-left corner from the new extents', () => {
    // 30x10 at (10,20) has its centre at (25,25); rotated it is 10x30, so the
    // corner must move to (20,10) to keep that centre.
    expect(rotatedBounds({ ...box, rotation: 90 })).toEqual({
      xMm: 20, yMm: 10, widthMm: 10, heightMm: 30,
    })
  })

  it('is idempotent for a square', () => {
    const square = { xMm: 5, yMm: 5, widthMm: 8, heightMm: 8 }
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(rotatedBounds({ ...square, rotation })).toEqual(square)
    }
  })

  it('round-trips: rotating twice by 90 degrees restores the original box', () => {
    const once = rotatedBounds({ ...box, rotation: 90 })
    expect(rotatedBounds({ ...once, rotation: 90 })).toEqual(box)
  })
})
