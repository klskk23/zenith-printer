/**
 * Turn one job into the pages the driver will print.
 *
 * Not simply "render once, repeat N times": a data source row or a sequence
 * makes labels differ from one another. What varies and what does not is the
 * whole content of this module.
 */
import { evaluateIrStrict, formatSequence, type LabelIR } from '@zenith/shared'
import type { BinaryBitmap, PageSource } from '../drivers/port.ts'
import type { PrintJob } from '../domain/print-job.ts'

export interface RenderOne {
  (ir: LabelIR): BinaryBitmap
}

/**
 * Index of the *distinct content* a given label carries.
 *
 * With a data source it is the row: every copy of a row is identical, serial
 * included (FR-036). Without one there are no rows, and each copy is its own
 * unit so a sequence still steps once per label — which is what printing five
 * numbered labels meant before data sources existed.
 */
export function contentIndex(job: PrintJob, labelIndex: number): number {
  const { rows, copiesPerRow } = job.snapshot
  if (rows.length === 0) {
    return labelIndex
  }
  return Math.floor(labelIndex / Math.max(1, copiesPerRow))
}

/**
 * Values substituted into one label: the design's constants, its row, and this
 * job's serials.
 *
 * All three come off the snapshot, so a design edited after submission cannot
 * change what a reprint produces (FR-039, FR-040).
 */
export function valuesForLabel(job: PrintJob, labelIndex: number): Record<string, string> {
  const index = contentIndex(job, labelIndex)
  const { rows, constants } = job.snapshot

  if (rows.length > 0 && rows[index] === undefined) {
    // The job's page count and its row count disagree. Refusing beats printing
    // a label with blanks where the row values belong.
    throw new Error(
      `job ${job.id} asks for label ${labelIndex}, which needs row ${index} of ${rows.length}`,
    )
  }

  const values: Record<string, string> = { ...constants, ...(rows[index] ?? {}) }

  for (const claim of job.seqClaims) {
    values[claim.variableName] = formatSequence(
      claim.variableName,
      claim.start + index * claim.step,
      claim.digits,
    )
  }

  return values
}

/** Whether any two labels in this job differ. */
export function hasPerLabelContent(job: PrintJob): boolean {
  return job.seqClaims.length > 0 || job.snapshot.rows.length > 1
}

export function irForLabel(job: PrintJob, labelIndex: number): LabelIR {
  return evaluateIrStrict(job.snapshot.ir, valuesForLabel(job, labelIndex))
}

/**
 * The job's pages, rendered on demand.
 *
 * Nothing is rendered here: the first bitmap is produced when the driver asks
 * for it, which is what lets a thousand-label job start printing in the time
 * one label takes to render.
 *
 * When every label is identical the single render is cached and handed back for
 * every index — a hundred pointers to one bitmap rather than a hundred bitmaps.
 */
export function pageSource(job: PrintJob, render: RenderOne): PageSource {
  const total = job.requestedCopies

  if (!hasPerLabelContent(job)) {
    let single: BinaryBitmap | null = null
    return {
      total,
      at: () => {
        single ??= render(irForLabel(job, 0))
        return single
      },
    }
  }

  return { total, at: (index) => render(irForLabel(job, index)) }
}
