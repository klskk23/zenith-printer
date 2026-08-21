/**
 * Turn one job into the pages the driver will print.
 *
 * The reason this is not simply "render once, repeat N times": a sequence field
 * makes every copy different. Eighty labels then need eighty renders, each with
 * its own serial substituted.
 *
 * When nothing varies, one render is reused by reference — a hundred pointers
 * to one bitmap rather than a hundred bitmaps.
 */
import { resolveVariables, type LabelIR } from '@zenith/shared'
import type { BinaryBitmap } from '../drivers/port.ts'
import type { PrintJob } from '../domain/print-job.ts'

export interface RenderOne {
  (ir: LabelIR): BinaryBitmap
}

/** Values for one copy: manual fields fixed, sequence fields stepped. */
export function valuesForCopy(job: PrintJob, copyIndex: number): Record<string, string> {
  const values: Record<string, string> = { ...job.manualFieldValues }

  for (const [name, range] of Object.entries(job.seqRanges)) {
    const value = range.start + copyIndex * range.step
    values[name] = String(value).padStart(range.digits, '0')
  }

  return values
}

export function hasPerCopyContent(job: PrintJob): boolean {
  return Object.keys(job.seqRanges).length > 0
}

/** Build every page for a job. */
export function buildJobPages(job: PrintJob, render: RenderOne): BinaryBitmap[] {
  if (!hasPerCopyContent(job)) {
    // Identical copies: render once and hand back the same object repeatedly.
    const single = render(resolveVariables(job.snapshot.ir, job.manualFieldValues))
    return Array.from({ length: job.requestedCopies }, () => single)
  }

  return Array.from({ length: job.requestedCopies }, (_unused, index) =>
    render(resolveVariables(job.snapshot.ir, valuesForCopy(job, index))),
  )
}
