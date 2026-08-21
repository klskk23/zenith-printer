/**
 * The facts a job row has to carry.
 *
 * Both lists showed a status and an id fragment, which answers neither of the
 * questions actually asked of them: *when* was this printed, and *what* was
 * printed. An id fragment identifies a row to a developer reading logs; it
 * tells the person holding the labels nothing.
 */
import type { PrintJob } from './hooks.ts'

/** Statuses that are still in flight; the rest belong to history. */
export const ACTIVE_STATUSES = new Set(['queued', 'printing'])
export const FINISHED_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function isActive(job: PrintJob): boolean {
  return ACTIVE_STATUSES.has(job.status)
}

export function isFinished(job: PrintJob): boolean {
  return FINISHED_STATUSES.has(job.status)
}

/**
 * What the queue page should show: what is in flight, plus what is blocking it.
 *
 * A failure pauses its printer's queue, so the failed job is exactly what the
 * person staring at a stalled queue needs to act on. Filing it straight into
 * history would empty the queue and leave them with a banner explaining a
 * problem whose cause is on another page.
 *
 * Once the queue is resumed the failure stops blocking anything, and the job
 * belongs in history like any other finished one.
 */
export function belongsInQueue(job: PrintJob, pausedPrinterIds: ReadonlySet<string>): boolean {
  if (isActive(job)) {
    return true
  }
  return job.status === 'failed' && job.printerId !== null && pausedPrinterIds.has(job.printerId)
}

/**
 * The most meaningful instant for this job.
 *
 * Finished jobs are about when they finished; anything still in flight is about
 * when it started, and a queued job about when it was asked for. Showing
 * `createdAt` for everything would make a job that sat in the queue for an hour
 * look like it printed an hour ago.
 */
export function jobInstant(job: PrintJob): string {
  return job.finishedAt ?? job.startedAt ?? job.createdAt
}

/**
 * Local date and time, to the minute.
 *
 * Seconds are noise here — nobody reconciles labels to the second — and a full
 * ISO string is unreadable at a glance.
 */
export function formatInstant(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Whether this job came from a saved template.
 *
 * A one-off design has no template name, and the absence has to be stated:
 * a blank where a name goes reads as missing data rather than as "there was
 * never a template here".
 */
export function hasTemplate(job: PrintJob): boolean {
  return job.snapshot.templateName !== null && job.snapshot.templateName.length > 0
}
