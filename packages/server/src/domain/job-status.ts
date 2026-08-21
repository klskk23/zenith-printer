/**
 * Print job state machine.
 *
 * Small, and worth writing down precisely, because the transitions encode
 * decisions that cost physical stock when they go wrong:
 *
 *   - cancellation is only possible before printing starts. Labels already
 *     coming out cannot be recalled, and stopping mid-run leaves the printed
 *     count unverifiable (FR-019).
 *   - any failure pauses the whole queue. If the paper ran out, every job
 *     behind it would fail too — printing them anyway just produces a pile of
 *     waste and a screen of identical errors (FR-021).
 *   - terminal states are terminal. Nothing retries by itself, because a retry
 *     that nobody asked for is a second batch of labels.
 */
import type { JobStatus } from './print-job.ts'

export const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'printing',
  'completed',
  'failed',
  'cancelled',
]

const ALLOWED: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['printing', 'cancelled', 'failed'],
  // No path back to `queued`: re-running is a new job with its own idempotency
  // key, so the record of what was already printed stays intact.
  printing: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

export function isTerminalStatus(status: JobStatus): boolean {
  return ALLOWED[status].length === 0
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to)
}

export class InvalidTransitionError extends Error {
  readonly from: JobStatus
  readonly to: JobStatus

  constructor(from: JobStatus, to: JobStatus) {
    super(`cannot move a job from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

/** Whether a job can still be cancelled (FR-019). */
export function isCancellableStatus(status: JobStatus): boolean {
  return canTransition(status, 'cancelled')
}

/**
 * Whether reaching this state should pause the printer's queue.
 * Only failures do: a cancellation is a deliberate act, not a fault, and
 * halting everyone else's work over it would be wrong.
 */
export function pausesQueue(status: JobStatus): boolean {
  return status === 'failed'
}
