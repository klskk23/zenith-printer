/**
 * Queue wiring.
 *
 * Owns the single `PrintQueue` for the process and builds the render function
 * it needs. Kept separate from the API so routes stay ignorant of drivers and
 * rendering; they only ask for a drain.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { formatSequence, resolveVariables, type LabelIR } from '@zenith/shared'
import type { FastifyInstance } from 'fastify'
import { PrintQueue } from './print-queue.ts'
import { JobRepo } from '../db/repositories/job-repo.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { createDriver } from '../drivers/factory.ts'
import type { Logger } from '../drivers/frame-logger.ts'
import { renderLabel } from '../render/pipeline.ts'
import { loadFontConfig } from '../render/fonts.ts'
import { createImageResolver } from '../render/image-resolver.ts'
import { mmToDots } from '@zenith/shared'
import type { BinaryBitmap } from '../drivers/port.ts'
import type { PrintJob, SequenceRange } from '../domain/print-job.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * Value of a sequence field for one copy.
 * Overflow is impossible here because the range was validated and locked at
 * enqueue time (FR-046, FR-049).
 */
export function sequenceValueFor(range: SequenceRange, copyIndex: number): string {
  return formatSequence('sequence', range.start + copyIndex * range.step, range.digits)
}

export function createQueue(app: FastifyInstance): PrintQueue {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))

  const repos = () => ({
    jobs: new JobRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
    printers: new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
    images: new ImageRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
  })

  const { jobs, printers, images } = repos()
  const logger = app.log as unknown as Logger

  return new PrintQueue({
    jobs,
    printers,
    clock: app.ctx.clock,
    logger,
    createDriver: (printerId, jobId) => {
      const printer = printers.find(printerId)
      if (printer === undefined) {
        throw new Error(`printer ${printerId} disappeared before its job ran`)
      }
      return createDriver(printer, { logger, jobId })
    },
    renderPage: (ir: LabelIR): BinaryBitmap => {
      // Assets must be inlined: resvg has no HTTP client, and an unresolved
      // href is skipped silently — the logo would vanish from the label with
      // nothing anywhere reporting a problem.
      const result = renderLabel({
        ir,
        fonts,
        svgOptions: { resolveImage: createImageResolver(images) },
      })
      return result.bitmap
    },
  })
}

/** Apply per-copy sequence values before rendering. */
export function irForCopy(job: PrintJob, copyIndex: number): LabelIR {
  const values: Record<string, string> = { ...job.manualFieldValues }
  for (const [name, range] of Object.entries(job.seqRanges)) {
    values[name] = sequenceValueFor(range, copyIndex)
  }
  return resolveVariables(job.snapshot.ir, values)
}

export { mmToDots }
