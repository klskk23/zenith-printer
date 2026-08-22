/**
 * Per-printer serial queue.
 *
 * One runner per printer, strictly one job at a time. Two jobs interleaving on
 * the same head would produce a stack of labels nobody can sort out, so the
 * serialisation is not an optimisation — it is the correctness property.
 *
 * Connections are per job: open, pre-flight, print, close. That keeps the two
 * printer types behaving identically and sidesteps the idle shutdown, since a
 * sleeping device simply fails to open instead of dying halfway through a
 * reconnect state machine.
 */
import type { LabelIR } from '@zenith/shared'
import { pageSource } from '../render/job-pages.ts'
import type { Clock } from '../clock.ts'
import type { Logger } from '../drivers/frame-logger.ts'
import {
  PrinterDeviceError,
  PrinterUnreachableError,
  type BinaryBitmap,
  type PrinterDriver,
  type PageSource,
} from '../drivers/port.ts'
import type { JobRepo } from '../db/repositories/job-repo.ts'
import type { PrinterRepo } from '../db/repositories/printer-repo.ts'
import type { PrintJob } from '../domain/print-job.ts'
import { pausesQueue } from '../domain/job-status.ts'
import { deviceErrorCode } from '../i18n/error-map.ts'
import type { HalftoneMode } from '../render/dither.ts'
import { DEFAULT_THRESHOLD } from '../render/binarize.ts'

export interface PageRenderOptions {
  offsetXDots: number
  offsetYDots: number
  /**
   * How tone inside image elements is rendered.
   *
   * Carried on the signature rather than read from the printer at render time,
   * for the same reason as the offset above it: a value the callback cannot
   * receive is a value that silently never arrives. That is exactly how a
   * saved position correction once moved the preview and left the printed
   * label where it was.
   */
  halftone: HalftoneMode
  /** The luminance below which a pixel becomes a print dot. */
  threshold: number
}

export interface RenderPage {
  (ir: LabelIR, options: PageRenderOptions): BinaryBitmap
}

export interface QueueDeps {
  jobs: JobRepo
  printers: PrinterRepo
  clock: Clock
  logger: Logger
  /** Builds a driver for a printer; injected so tests never touch hardware. */
  createDriver: (printerId: string, jobId: string) => PrinterDriver
  /** Renders one fully resolved label. Per-copy substitution happens above. */
  renderPage: RenderPage
}

export interface RunOutcome {
  jobId: string
  status: 'completed' | 'failed' | 'skipped'
  pagesPrinted: number | null
  failureCode?: string
}

export class PrintQueue {
  readonly #deps: QueueDeps
  /** One in-flight promise per printer — the serialisation itself. */
  readonly #running = new Map<string, Promise<void>>()

  constructor(deps: QueueDeps) {
    this.#deps = deps
  }

  /** Whether this printer currently has a job in flight. */
  isBusy(printerId: string): boolean {
    return this.#running.has(printerId)
  }

  /**
   * Ask the runner for a printer to drain its queue.
   * Safe to call repeatedly: a second call while one is in flight is a no-op,
   * which is what keeps jobs from overlapping.
   */
  async drain(printerId: string): Promise<void> {
    const inFlight = this.#running.get(printerId)
    if (inFlight !== undefined) {
      return inFlight
    }
    const run = this.#drainLoop(printerId).finally(() => this.#running.delete(printerId))
    this.#running.set(printerId, run)
    return run
  }

  async #drainLoop(printerId: string): Promise<void> {
    for (;;) {
      const printer = this.#deps.printers.find(printerId)
      if (printer === undefined || printer.queueState === 'paused') {
        // Paused means paused: the job in flight finishes, nothing else starts
        // (FR-022). A failure already paused us, so this is also the brake
        // that stops a bad batch after the first casualty.
        return
      }

      const next = this.#deps.jobs.list({ printerId, status: 'queued' })[0]
      if (next === undefined) {
        return
      }

      await this.#runJob(next)
    }
  }

  async #runJob(job: PrintJob): Promise<RunOutcome> {
    const { jobs, printers, logger } = this.#deps
    const printerId = job.printerId
    if (printerId === null) {
      jobs.markFailed(job.id, 'VALIDATION_FAILED', 'job has no printer', 0)
      return { jobId: job.id, status: 'failed', pagesPrinted: 0, failureCode: 'VALIDATION_FAILED' }
    }

    const driver = this.#deps.createDriver(printerId, job.id)
    let pagesPrinted = 0

    const fail = (code: string, message: string, printed: number | null): RunOutcome => {
      jobs.markFailed(job.id, code, message, printed)
      if (pausesQueue('failed')) {
        // Whatever stopped this job will stop the next one too; printing them
        // anyway just makes waste (FR-021).
        printers.setQueueState(printerId, 'paused', code)
      }
      logger.info({ jobId: job.id, printerId, code }, 'print job failed')
      return { jobId: job.id, status: 'failed', pagesPrinted: printed, failureCode: code }
    }

    try {
      await driver.connect()
    } catch (err) {
      // Unreachable is its own class because it is the only failure that needs
      // somebody to walk over to the machine. No retry (FR-047).
      const code = err instanceof PrinterUnreachableError ? 'PRINTER_UNREACHABLE' : 'DEVICE_ERROR'
      return fail(code, err instanceof Error ? err.message : String(err), 0)
    }

    try {
      const preflight = await driver.preflight(job.requestedCopies)

      if (preflight.remainingLabels !== null && preflight.remainingLabels < job.requestedCopies) {
        // Caught before a single label is burned (FR-015).
        return fail(
          'INSUFFICIENT_CONSUMABLE',
          `${preflight.remainingLabels} remaining, ${job.requestedCopies} requested`,
          0,
        )
      }

      if (!preflight.ok) {
        const blocker = preflight.blockers[0]
        return fail(
          blocker === undefined ? 'DEVICE_ERROR' : deviceErrorCode(blocker),
          `preflight blocked: ${preflight.blockers.join(', ')}`,
          0,
        )
      }

      jobs.markStarted(job.id)

      const pages = this.#buildPages(job)

      await driver.printPages(
        pages,
        {
          density: job.snapshot.profile.density,
          labelType: job.snapshot.profile.labelType,
          printDirection: 'top',
        },
        (printed) => {
          pagesPrinted = printed
          jobs.updateProgress(job.id, printed)
        },
      )

      jobs.markCompleted(job.id, job.requestedCopies)
      logger.info({ jobId: job.id, printerId, copies: job.requestedCopies }, 'print job completed')
      return { jobId: job.id, status: 'completed', pagesPrinted: job.requestedCopies }
    } catch (err) {
      const code =
        err instanceof PrinterDeviceError && err.reasonId !== undefined
          ? deviceErrorCode(err.reasonId)
          : err instanceof PrinterUnreachableError
            ? 'PRINTER_UNREACHABLE'
            : 'DEVICE_ERROR'
      // The count matters: it is the only basis for reprinting exactly the
      // shortfall rather than the whole batch (FR-020).
      return fail(code, err instanceof Error ? err.message : String(err), pagesPrinted)
    } finally {
      // Constitution ("Resource safety"): release on every path.
      await driver.disconnect()
    }
  }

  /**
   * The job's pages, produced on demand.
   *
   * Nothing is rendered by this call. The driver pulls page zero, starts
   * printing it, and pulls the next — so the time to the first label is one
   * render regardless of how many were asked for.
   */
  #buildPages(job: PrintJob): PageSource {
    // The correction comes from the job's snapshot rather than from the
    // printer as it stands now: it was captured at submission, and the printer
    // is expected to be recalibrated between then and here.
    return pageSource(job, (ir) =>
      this.#deps.renderPage(ir, {
        offsetXDots: job.snapshot.offsetXDots,
        offsetYDots: job.snapshot.offsetYDots,
        // From the snapshot, not from the profile as it stands now: a reprint
        // has to come out like the batch it is completing.
        halftone: job.snapshot.profile.halftone ?? 'none',
        threshold: job.snapshot.profile.threshold ?? DEFAULT_THRESHOLD,
      }),
    )
  }

  /**
   * Clean up jobs a crash left mid-print (FR-053).
   *
   * `pagesPrinted` becomes null rather than a number: the count at the moment
   * of the crash is genuinely unknowable — progress is reported per page, the
   * last few may not have been persisted, and the printer's own buffer may
   * still have held pages. A confident wrong number is worse than "unknown",
   * because reprinting from it would duplicate or skip labels.
   */
  recoverInterruptedJobs(): PrintJob[] {
    const { jobs, printers, logger } = this.#deps
    const interrupted = jobs.findInterrupted()

    for (const job of interrupted) {
      jobs.markFailed(
        job.id,
        'JOB_INTERRUPTED_BY_RESTART',
        'service restarted while this job was printing',
        null,
      )
      if (job.printerId !== null) {
        // The physical state is unknown too — where the paper stopped, whether
        // it jammed — so the next job must not start unsupervised.
        printers.setQueueState(job.printerId, 'paused', 'JOB_INTERRUPTED_BY_RESTART')
      }
      logger.info({ jobId: job.id, printerId: job.printerId }, 'recovered interrupted job')
    }

    return interrupted
  }
}
