import { describe, expect, it } from 'vitest'
import {
  belongsInQueue,
  formatInstant,
  hasTemplate,
  isActive,
  isFinished,
  jobInstant,
} from '../src/features/jobs/job-summary.ts'
import type { PrintJob } from '../src/features/jobs/hooks.ts'

function job(over: Partial<PrintJob> = {}): PrintJob {
  return {
    id: 'job-1',
    printerId: 'prn-1',
    status: 'completed',
    requestedCopies: 10,
    pagesPrinted: 10,
    failureCode: null,
    failureMessage: null,
    snapshot: { templateName: 'shipping', widthMm: 50, heightMm: 30 },
    createdAt: '2026-08-21T09:00:00.000Z',
    startedAt: '2026-08-21T10:00:00.000Z',
    finishedAt: '2026-08-21T11:00:00.000Z',
    ...over,
  } as PrintJob
}

describe('which list a job belongs in', () => {
  it.each(['queued', 'printing'])('keeps %s in the queue', (status) => {
    expect(isActive(job({ status: status as PrintJob['status'] }))).toBe(true)
    expect(isFinished(job({ status: status as PrintJob['status'] }))).toBe(false)
  })

  it.each(['completed', 'failed', 'cancelled'])('moves %s to history', (status) => {
    expect(isFinished(job({ status: status as PrintJob['status'] }))).toBe(true)
    expect(isActive(job({ status: status as PrintJob['status'] }))).toBe(false)
  })

  it('puts every status in exactly one of the two', () => {
    for (const status of ['queued', 'printing', 'completed', 'failed', 'cancelled'] as const) {
      const j = job({ status })
      expect(Number(isActive(j)) + Number(isFinished(j))).toBe(1)
    }
  })
})

describe('which instant to show', () => {
  it('uses the finish time for a finished job', () => {
    expect(jobInstant(job())).toBe('2026-08-21T11:00:00.000Z')
  })

  it('falls back to the start time while printing', () => {
    expect(jobInstant(job({ status: 'printing', finishedAt: null }))).toBe('2026-08-21T10:00:00.000Z')
  })

  /**
   * A job that sat in the queue for an hour would otherwise look like it
   * printed an hour ago.
   */
  it('falls back to submission only while queued', () => {
    expect(jobInstant(job({ status: 'queued', finishedAt: null, startedAt: null })))
      .toBe('2026-08-21T09:00:00.000Z')
  })
})

describe('formatInstant', () => {
  it('renders something readable', () => {
    const text = formatInstant('2026-08-21T11:00:00.000Z', 'zh-CN')
    expect(text).toMatch(/2026/)
    expect(text).not.toContain('T')
  })

  it('omits seconds, which nobody reconciles labels to', () => {
    expect(formatInstant('2026-08-21T11:00:45.000Z', 'zh-CN')).not.toMatch(/45/)
  })

  it('returns unparseable input as-is rather than showing "Invalid Date"', () => {
    expect(formatInstant('not a date', 'zh-CN')).toBe('not a date')
  })
})

describe('hasTemplate', () => {
  it('is true for a job printed from a template', () => {
    expect(hasTemplate(job())).toBe(true)
  })

  /**
   * A one-off design has no template, and that has to be stated: a blank where
   * a name goes reads as missing data, not as "there was never one".
   */
  it('is false for a one-off design', () => {
    expect(hasTemplate(job({ snapshot: { templateName: null, widthMm: 50, heightMm: 30 } }))).toBe(false)
  })

  it('treats an empty name as absent', () => {
    expect(hasTemplate(job({ snapshot: { templateName: '', widthMm: 50, heightMm: 30 } }))).toBe(false)
  })
})

/**
 * What the queue shows.
 *
 * A failure pauses its printer's queue, so the failed job is exactly what the
 * person staring at a stalled queue needs to act on. Filing it straight into
 * history would empty the queue and leave a banner explaining a problem whose
 * cause is on another page.
 */
describe('belongsInQueue', () => {
  const paused = new Set(['prn-1'])
  const running = new Set<string>()

  it.each(['queued', 'printing'])('always keeps %s', (status) => {
    expect(belongsInQueue(job({ status: status as PrintJob['status'] }), running)).toBe(true)
  })

  it('keeps a failure that is holding the queue', () => {
    expect(belongsInQueue(job({ status: 'failed' }), paused)).toBe(true)
  })

  it('releases it once the queue is resumed', () => {
    expect(belongsInQueue(job({ status: 'failed' }), running)).toBe(false)
  })

  it('does not keep a failure from a different printer', () => {
    expect(belongsInQueue(job({ status: 'failed', printerId: 'prn-2' }), paused)).toBe(false)
  })

  it.each(['completed', 'cancelled'])('never keeps %s', (status) => {
    expect(belongsInQueue(job({ status: status as PrintJob['status'] }), paused)).toBe(false)
  })
})
