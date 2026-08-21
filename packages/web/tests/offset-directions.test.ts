/**
 * Four direction inputs over two signed values.
 *
 * Someone who has just reloaded a roll perceives the fault as "it printed too
 * high", so the controls are up/right/down/left. Storage keeps two signed
 * numbers, which is what makes the contradictory state — up 2 *and* down 3 —
 * inexpressible rather than merely discouraged.
 */
import { describe, expect, it } from 'vitest'
import {
  directionsToOffset,
  offsetToDirections,
  setDirection,
} from '../src/features/printers/offset-directions.ts'

const zero = { upDots: 0, rightDots: 0, downDots: 0, leftDots: 0 }

describe('directionsToOffset', () => {
  it('maps down to positive y', () => {
    expect(directionsToOffset({ ...zero, downDots: 3 })).toEqual({ offsetXDots: 0, offsetYDots: 3 })
  })

  it('maps up to negative y', () => {
    expect(directionsToOffset({ ...zero, upDots: 3 })).toEqual({ offsetXDots: 0, offsetYDots: -3 })
  })

  it('maps right to positive x and left to negative', () => {
    expect(directionsToOffset({ ...zero, rightDots: 2 }).offsetXDots).toBe(2)
    expect(directionsToOffset({ ...zero, leftDots: 2 }).offsetXDots).toBe(-2)
  })

  it('rounds to whole dots', () => {
    expect(directionsToOffset({ ...zero, downDots: 2.6 }).offsetYDots).toBe(3)
  })

  it('never produces a fractional dot', () => {
    for (const value of [0.1, 1.5, 7.49, 12.5]) {
      const offset = directionsToOffset({ ...zero, downDots: value })
      expect(Number.isInteger(offset.offsetYDots)).toBe(true)
    }
  })
})

describe('offsetToDirections', () => {
  it('puts a positive y in "down" and leaves "up" at zero', () => {
    expect(offsetToDirections({ offsetXDots: 0, offsetYDots: 4 })).toMatchObject({ downDots: 4, upDots: 0 })
  })

  it('puts a negative y in "up"', () => {
    expect(offsetToDirections({ offsetXDots: 0, offsetYDots: -4 })).toMatchObject({ upDots: 4, downDots: 0 })
  })

  it('never fills both of an opposing pair', () => {
    for (const y of [-5, -1, 0, 1, 5]) {
      for (const x of [-5, 0, 5]) {
        const d = offsetToDirections({ offsetXDots: x, offsetYDots: y })
        // The state "up 2 and down 3" has no meaning; it must be unreachable.
        expect(Math.min(d.upDots, d.downDots)).toBe(0)
        expect(Math.min(d.leftDots, d.rightDots)).toBe(0)
      }
    }
  })

  it('shows zero in every box for no correction', () => {
    expect(offsetToDirections({ offsetXDots: 0, offsetYDots: 0 })).toEqual(zero)
  })
})

describe('round trip', () => {
  it('survives storage and redisplay', () => {
    for (const offset of [
      { offsetXDots: 0, offsetYDots: 0 },
      { offsetXDots: 4, offsetYDots: -2 },
      { offsetXDots: -7, offsetYDots: 9 },
    ]) {
      expect(directionsToOffset(offsetToDirections(offset))).toEqual(offset)
    }
  })

  it('resolves a contradictory input to the net movement', () => {
    // The UI clears the opposite box, but if both ever arrived the result must
    // still be a single coherent translation rather than an error state.
    expect(directionsToOffset({ ...zero, upDots: 2, downDots: 3 }).offsetYDots).toBe(1)
  })
})

describe('setDirection', () => {
  const filled = { upDots: 2, rightDots: 3, downDots: 0, leftDots: 0 }

  it('clears the opposing box when one is typed into', () => {
    expect(setDirection(filled, 'downDots', 5)).toMatchObject({ downDots: 5, upDots: 0 })
  })

  it('leaves the other axis alone', () => {
    expect(setDirection(filled, 'downDots', 5).rightDots).toBe(3)
  })

  it('refuses a negative, since direction is carried by which box you use', () => {
    expect(setDirection(filled, 'downDots', -4).downDots).toBe(0)
  })
})
