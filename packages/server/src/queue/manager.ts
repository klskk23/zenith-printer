/**
 * Queue wiring.
 *
 * Owns the single `PrintQueue` for the process and builds the render function
 * it needs. Kept separate from the API so routes stay ignorant of drivers and
 * rendering; they only ask for a drain.
 */
import { join } from 'node:path'
import { repoRoot } from '../paths.ts'
import { formatSequence, type LabelIR } from '@zenith/shared'
import type { FastifyInstance } from 'fastify'
import { PrintQueue, type PageRenderOptions } from './print-queue.ts'
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
import type { PrintJob, SequenceClaim } from '../domain/print-job.ts'
import { irForLabel } from '../render/job-pages.ts'


/**
 * Value of a sequence variable at a given position in the batch.
 * Overflow is impossible here because the span was validated and locked at
 * enqueue time (FR-046, FR-049).
 */
export function sequenceValueFor(claim: SequenceClaim, index: number): string {
  return formatSequence(claim.variableName, claim.start + index * claim.step, claim.digits)
}

export function createQueue(app: FastifyInstance): PrintQueue {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))

  const repos = () => ({
    jobs: new JobRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
    printers: new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
    images: new ImageRepo({
      db: app.ctx.db,
      clock: app.ctx.clock,
      ids: app.ctx.ids,
      storageDir: app.ctx.imageStorageDir,
    }),
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
    renderPage: (ir: LabelIR, options: PageRenderOptions): BinaryBitmap => {
      // Assets must be inlined: resvg has no HTTP client, and an unresolved
      // href is skipped silently — the logo would vanish from the label with
      // nothing anywhere reporting a problem.
      //
      // The position correction is applied here, on the print path. It used to
      // be passed only on the preview path, so a saved offset moved the preview
      // and left the printed label exactly where it was — the one combination
      // that gives no sign anything is wrong.
      const result = renderLabel({
        ir,
        fonts,
        svgOptions: { resolveImage: createImageResolver(images) },
        offsetXDots: options.offsetXDots,
        offsetYDots: options.offsetYDots,
        halftone: options.halftone,
        threshold: options.threshold,
      })
      return result.bitmap
    },
  })
}

/** The label at a given position in the batch, fully substituted. */
export function irForCopy(job: PrintJob, copyIndex: number): LabelIR {
  return irForLabel(job, copyIndex)
}

export { mmToDots }
