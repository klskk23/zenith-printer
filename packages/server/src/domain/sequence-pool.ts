/**
 * Sequence pool — a counter that exists in its own right.
 *
 * It is not owned by a design. Two designs (a small box label and the outer
 * carton label) drawing from one run of numbers is a real requirement, and it
 * only works if the counter outlives whichever design references it.
 *
 * **The current value is not stored.** It is `max(floor, highest claimed)`,
 * derived from the claims recorded against printed jobs. That is deliberate:
 * the numbers are on physical labels, and the job history is the evidence of
 * which ones. A second, stored counter could disagree with that history, and
 * when it did there would be no way to tell which one was on the labels — while
 * the cost of guessing wrong is two boxes carrying the same serial.
 *
 * `floor` exists only because a pure derivation cannot be reset: resetting means
 * making the current value smaller, and history does not shrink. `floor` is a
 * declaration that numbering starts again here, not a second source of truth.
 */
import { z } from 'zod'

export const MAX_SEQUENCE_DIGITS = 12

export const sequencePoolInputSchema = z.object({
  name: z.string().min(1).max(60),
  digits: z.number().int().min(1).max(MAX_SEQUENCE_DIGITS),
  step: z.number().int().min(1).default(1),
})
export type SequencePoolInput = z.infer<typeof sequencePoolInputSchema>

export interface SequencePool extends SequencePoolInput {
  id: string
  floor: number
  createdAt: string
}

/** Largest value the configured width can represent. */
export function maxRepresentable(digits: number): number {
  return 10 ** digits - 1
}

/**
 * The pool's current value: the highest number issued *since the last reset*.
 *
 * `highestClaimed` is null when nothing has been issued since then, in which
 * case the floor stands alone and the next number out is the floor itself.
 * Claims from before a reset are still on record — they are the evidence of
 * what went onto labels — they simply stop counting here, which is what makes
 * resetting downwards possible at all.
 */
export function currentValue(floor: number, highestClaimed: number | null): number {
  return highestClaimed === null ? floor : Math.max(floor, highestClaimed)
}

export function nextValue(pool: SequencePool, highestClaimed: number | null): number {
  return highestClaimed === null
    ? Math.max(pool.floor, 1)
    : currentValue(pool.floor, highestClaimed) + pool.step
}

export class SequenceOverflowError extends Error {
  readonly poolName: string
  readonly requestedEnd: number
  readonly maxValue: number

  constructor(poolName: string, requestedEnd: number, maxValue: number) {
    super(`sequence "${poolName}" would reach ${requestedEnd}, above the maximum ${maxValue}`)
    this.name = 'SequenceOverflowError'
    this.poolName = poolName
    this.requestedEnd = requestedEnd
    this.maxValue = maxValue
  }
}

/**
 * The span a run of `count` labels will consume, starting at `start`.
 *
 * `end` is the last value actually used, so a one-label run spans a single
 * number rather than a half-open interval nobody can read at a glance.
 *
 * Overflow is refused, not wrapped: wrapping 999 back to 000 silently reissues
 * serials that already exist on physical stock.
 */
export function spanFor(
  pool: SequencePool,
  start: number,
  count: number,
): { start: number; end: number; step: number; digits: number } {
  const end = start + (count - 1) * pool.step
  const max = maxRepresentable(pool.digits)
  if (end > max) {
    throw new SequenceOverflowError(pool.name, end, max)
  }
  return { start, end, step: pool.step, digits: pool.digits }
}
