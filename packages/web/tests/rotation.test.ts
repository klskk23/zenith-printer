import { describe, expect, it } from 'vitest'
import { ROTATIONS, angleFromCentre, rotateClockwise, snapRotation } from '../src/editor/rotation.ts'

describe('snapRotation', () => {
  it.each([
    [0, 0], [10, 0], [44, 0], [46, 90], [90, 90], [134, 90],
    [136, 180], [180, 180], [225, 270], [270, 270], [315, 0], [359, 0],
  ])('snaps %i degrees to %i', (input, expected) => {
    expect(snapRotation(input)).toBe(expected)
  })

  it('never returns an angle off the quarter turns', () => {
    for (let degrees = -720; degrees <= 720; degrees += 7) {
      expect(ROTATIONS).toContain(snapRotation(degrees))
    }
  })

  it('handles negative angles', () => {
    expect(snapRotation(-90)).toBe(270)
    expect(snapRotation(-10)).toBe(0)
  })

  it('handles angles beyond a full turn', () => {
    expect(snapRotation(450)).toBe(90)
    expect(snapRotation(720)).toBe(0)
  })
})

describe('angleFromCentre', () => {
  const centre = { x: 100, y: 100 }

  it('reads straight up as zero', () => {
    expect(angleFromCentre(centre, { x: 100, y: 50 })).toBeCloseTo(0, 6)
  })

  it('reads right as 90 degrees', () => {
    expect(angleFromCentre(centre, { x: 150, y: 100 })).toBeCloseTo(90, 6)
  })

  it('reads down as 180 degrees', () => {
    expect(Math.abs(angleFromCentre(centre, { x: 100, y: 150 }))).toBeCloseTo(180, 6)
  })

  it('feeds snapRotation so a drag can only land on a right angle', () => {
    // Whatever the pointer does, the element cannot come to rest at 37 degrees.
    for (const pointer of [{ x: 137, y: 61 }, { x: 12, y: 190 }, { x: 99, y: 3 }]) {
      expect(ROTATIONS).toContain(snapRotation(angleFromCentre(centre, pointer)))
    }
  })
})

describe('rotateClockwise', () => {
  it('cycles through the quarter turns', () => {
    expect(rotateClockwise(0)).toBe(90)
    expect(rotateClockwise(90)).toBe(180)
    expect(rotateClockwise(180)).toBe(270)
    expect(rotateClockwise(270)).toBe(0)
  })

  it('returns to the start after four turns', () => {
    let angle = rotateClockwise(0)
    for (let i = 0; i < 3; i += 1) angle = rotateClockwise(angle)
    expect(angle).toBe(0)
  })
})
