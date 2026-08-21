import { describe, expect, it } from 'vitest'
import {
  InvalidTransitionError,
  JOB_STATUSES,
  assertTransition,
  canTransition,
  isCancellableStatus,
  isTerminalStatus,
  pausesQueue,
} from '../../src/domain/job-status.ts'
import type { JobStatus } from '../../src/domain/print-job.ts'

describe('legal transitions', () => {
  it('lets a queued job start printing', () => {
    expect(canTransition('queued', 'printing')).toBe(true)
  })

  it('lets a printing job finish or fail', () => {
    expect(canTransition('printing', 'completed')).toBe(true)
    expect(canTransition('printing', 'failed')).toBe(true)
  })

  it('lets a queued job fail before it starts', () => {
    // Pre-flight rejections and unreachable printers land here.
    expect(canTransition('queued', 'failed')).toBe(true)
  })
})

describe('cancellation', () => {
  it('is possible only before printing starts', () => {
    // FR-019: labels already coming out cannot be recalled, and stopping
    // mid-run leaves the printed count unverifiable.
    expect(isCancellableStatus('queued')).toBe(true)
    expect(isCancellableStatus('printing')).toBe(false)
  })

  it('is impossible from any terminal state', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as JobStatus[]) {
      expect(isCancellableStatus(status)).toBe(false)
    }
  })
})

describe('terminal states', () => {
  it.each(['completed', 'failed', 'cancelled'] as JobStatus[])('%s is terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(true)
  })

  it.each(['queued', 'printing'] as JobStatus[])('%s is not terminal', (status) => {
    expect(isTerminalStatus(status)).toBe(false)
  })

  it('never returns a job to the queue', () => {
    // Re-running is a new job with its own idempotency key, so the record of
    // what was already printed stays intact.
    for (const status of JOB_STATUSES) {
      expect(canTransition(status, 'queued')).toBe(false)
    }
  })

  it('does not retry by itself', () => {
    expect(canTransition('failed', 'printing')).toBe(false)
    expect(canTransition('failed', 'queued')).toBe(false)
  })
})

describe('queue pausing', () => {
  it('pauses the queue on failure', () => {
    // Whatever stopped this job stops the next one too; carrying on just
    // produces waste and a screen of identical errors (FR-021).
    expect(pausesQueue('failed')).toBe(true)
  })

  it('does not pause on cancellation', () => {
    // A cancellation is a deliberate act, not a fault. Halting everybody
    // else's work over it would be wrong.
    expect(pausesQueue('cancelled')).toBe(false)
  })

  it('does not pause on success', () => {
    expect(pausesQueue('completed')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('passes a legal move', () => {
    expect(() => assertTransition('queued', 'printing')).not.toThrow()
  })

  it('names both ends of an illegal move', () => {
    try {
      assertTransition('completed', 'printing')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError)
      expect((err as InvalidTransitionError).from).toBe('completed')
      expect((err as InvalidTransitionError).to).toBe('printing')
    }
  })
})
