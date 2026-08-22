import { describe, expect, it } from 'vitest'
import {
  SequenceOverflowError,
  currentValue,
  maxRepresentable,
  nextValue,
  sequencePoolInputSchema,
  spanFor,
  type SequencePool,
} from '../../src/domain/sequence-pool.ts'

/**
 * The pool's current value is derived, not stored.
 *
 * A stored counter can disagree with the job history, and when it does there
 * is no way to tell which one is on the labels — while the cost of guessing
 * wrong is two boxes carrying the same serial. These tests pin the derivation.
 */
const pool = (over: Partial<SequencePool> = {}): SequencePool => ({
  id: 'p1',
  name: '整机流水',
  digits: 6,
  step: 1,
  floor: 0,
  createdAt: '2026-08-22T00:00:00Z',
  ...over,
})

describe('currentValue', () => {
  it('is the floor when nothing has been issued since the last reset', () => {
    expect(currentValue(0, null)).toBe(0)
    expect(currentValue(500, null)).toBe(500)
  })

  it('is the highest number issued once anything has been', () => {
    expect(currentValue(0, 42)).toBe(42)
  })

  it('takes whichever is greater, so a forward reset holds until passed', () => {
    expect(currentValue(1000, 42)).toBe(1000)
    expect(currentValue(10, 42)).toBe(42)
  })
})

describe('nextValue', () => {
  it('starts at the floor when nothing has been issued', () => {
    expect(nextValue(pool({ floor: 500 }), null)).toBe(500)
  })

  it('starts at one for a fresh pool, not at zero', () => {
    // Zero-based serials read as a bug on a physical label.
    expect(nextValue(pool({ floor: 0 }), null)).toBe(1)
  })

  it('steps on from the highest issued', () => {
    expect(nextValue(pool({ step: 1 }), 42)).toBe(43)
    expect(nextValue(pool({ step: 5 }), 40)).toBe(45)
  })
})

describe('spanFor', () => {
  it('makes end the last number actually used, not one past it', () => {
    // A one-label run spans a single number rather than a half-open interval
    // nobody can read at a glance.
    expect(spanFor(pool(), 1, 1)).toEqual({ start: 1, end: 1, step: 1, digits: 6 })
    expect(spanFor(pool(), 1, 5)).toEqual({ start: 1, end: 5, step: 1, digits: 6 })
  })

  it('honours the step', () => {
    expect(spanFor(pool({ step: 5 }), 10, 4)).toMatchObject({ start: 10, end: 25 })
  })

  it('refuses rather than wrapping past the configured width', () => {
    // Wrapping 999 back to 000 reissues serials that already exist on stock.
    expect(() => spanFor(pool({ digits: 3 }), 998, 5)).toThrow(SequenceOverflowError)
  })

  it('names the pool and the limit, so the message can say what to change', () => {
    try {
      spanFor(pool({ digits: 3, name: '三位' }), 998, 5)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toMatchObject({ poolName: '三位', requestedEnd: 1002, maxValue: 999 })
    }
  })

  it('allows a span that lands exactly on the maximum', () => {
    expect(spanFor(pool({ digits: 3 }), 995, 5)).toMatchObject({ end: 999 })
  })

  it('carries the configured width, never one inferred from end', () => {
    // A three-digit pool that only reaches 80 must still print 080, or the
    // labels do not sort.
    expect(spanFor(pool({ digits: 3 }), 1, 80).digits).toBe(3)
  })
})

describe('maxRepresentable', () => {
  it('is all nines for the configured width', () => {
    expect(maxRepresentable(1)).toBe(9)
    expect(maxRepresentable(6)).toBe(999999)
  })
})

describe('the input schema', () => {
  it('defaults the step to one', () => {
    expect(sequencePoolInputSchema.parse({ name: 'a', digits: 4 }).step).toBe(1)
  })

  it('rejects a zero or negative step, which would never advance', () => {
    expect(() => sequencePoolInputSchema.parse({ name: 'a', digits: 4, step: 0 })).toThrow()
    expect(() => sequencePoolInputSchema.parse({ name: 'a', digits: 4, step: -1 })).toThrow()
  })

  it('rejects a width outside what a label can carry', () => {
    expect(() => sequencePoolInputSchema.parse({ name: 'a', digits: 0 })).toThrow()
    expect(() => sequencePoolInputSchema.parse({ name: 'a', digits: 13 })).toThrow()
  })

  it('rejects an empty name, since the name is how a pool is picked', () => {
    expect(() => sequencePoolInputSchema.parse({ name: '', digits: 4 })).toThrow()
  })
})
