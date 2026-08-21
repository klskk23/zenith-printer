/**
 * Print job entity.
 *
 * Two properties here exist because printing is physical and irreversible:
 *
 *   - `pagesPrinted` is nullable, and null is NOT zero. Null means a crash left
 *     us unable to confirm how many labels came out (FR-053); the UI must say
 *     "unknown" and ask for a manual count rather than showing 0.
 *   - `snapshot` duplicates what was printed. Templates and profiles can then
 *     be edited or deleted without history drifting or breaking (FR-050).
 */
import { z } from 'zod'
import type { HalftoneMode } from '../render/dither.ts'
import type { OverflowWarning } from './overflow.ts'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import type { PrinterKind } from './printer.ts'

export const jobStatusSchema = z.enum(['queued', 'printing', 'completed', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof jobStatusSchema>

export const TERMINAL_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'cancelled']

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** Copies per job. The spec bounds this at 100 (Assumptions). */
export const MAX_COPIES = 100

/**
 * Submission body. Content comes from a saved template OR an ad-hoc IR, never
 * both. The ad-hoc path is what lets User Story 1 ship before templates exist:
 * design a label, print it, done — no need to save anything first.
 */
export const printJobInputSchema = z
  .object({
    printerId: z.string().min(1),
    templateId: z.string().min(1).optional(),
    ir: labelIrSchema.optional(),
    profileId: z.string().min(1).optional(),
    copies: z.number().int().min(1).max(MAX_COPIES).default(1),
    manualFieldValues: z.record(z.string(), z.string()).default({}),
    sequenceOverrides: z.record(z.string(), z.number().int().min(0)).default({}),
  })
  .refine((input) => (input.templateId === undefined) !== (input.ir === undefined), {
    message: 'provide exactly one of templateId or ir',
    path: ['ir'],
  })
export type PrintJobInput = z.infer<typeof printJobInputSchema>

/**
 * Sequence span consumed by one job, locked at enqueue time (FR-049).
 *
 * `digits` is stored rather than inferred. Deriving it from `end` looks
 * tempting and is wrong: a field configured for three digits that only reaches
 * 80 would print "80" instead of "080", and the labels would not sort.
 */
export interface SequenceRange {
  start: number
  end: number
  step: number
  digits: number
}

/**
 * Self-contained record of what was printed.
 * Never re-read from the template; that is the whole point (FR-050).
 */
export interface ContentSnapshot {
  templateName: string | null
  printerName: string
  printerModel: string | null
  printerKind: PrinterKind
  widthMm: number
  heightMm: number
  dpi: number
  ir: LabelIR
  profile: {
    name: string | null
    density: number
    labelType: number
    /**
     * Optional because jobs submitted before halftoning existed have no such
     * field, and they must go on reprinting exactly as they printed — which
     * is with a hard threshold.
     */
    halftone?: HalftoneMode
    /** Optional for the same reason as `halftone` above. */
    threshold?: number
  }
  /**
   * The position correction in force when this job ran, in dots.
   *
   * Recorded on the snapshot rather than read back from the printer, because
   * the printer's offset is expected to change — it is re-measured on every
   * paper reload. History has to show what was actually applied at the time,
   * not what the machine happens to be set to now (FR-050).
   */
  offsetXDots: number
  offsetYDots: number
  /**
   * What was clipped on this run.
   *
   * Recorded here rather than recomputed on read: the design can be edited or
   * deleted afterwards, and history has to say what actually happened (FR-050,
   * FR-091). Absent on jobs submitted before this was recorded.
   */
  overflowWarnings?: OverflowWarning[]
}

export interface PrintJob {
  id: string
  idempotencyKey: string
  printerId: string | null
  templateId: string | null
  profileId: string | null
  requestedCopies: number
  /** null means unknown, which is not the same as zero (FR-053). */
  pagesPrinted: number | null
  manualFieldValues: Record<string, string>
  seqRanges: Record<string, SequenceRange>
  status: JobStatus
  failureCode: string | null
  failureMessage: string | null
  snapshot: ContentSnapshot
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** Copies still owed after a partial failure, for a precise reprint (FR-020). */
export function remainingCopies(job: PrintJob): number | null {
  if (job.pagesPrinted === null) {
    // A manual count is required; guessing here could reprint or skip labels.
    return null
  }
  return Math.max(0, job.requestedCopies - job.pagesPrinted)
}

/** Whether cancelling is still possible (FR-019). */
export function isCancellable(job: PrintJob): boolean {
  return job.status === 'queued'
}
