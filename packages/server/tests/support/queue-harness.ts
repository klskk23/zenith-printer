/**
 * Test harness for the print queue.
 *
 * Everything the queue touches is injected, so the whole of User Story 2 is
 * exercised with no printer attached (Constitution Principle II). The fake
 * driver records call order and can be told to fail at a chosen page, which is
 * how partial-failure behaviour gets tested without wasting real stock.
 */
import { openDatabase, type Database } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { JobRepo } from '../../src/db/repositories/job-repo.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { PrintQueue } from '../../src/queue/print-queue.ts'
import {
  PrinterDeviceError,
  PrinterUnreachableError,
  type BinaryBitmap,
  type PreflightResult,
  type PrinterDriver,
  type PrintOptions,
} from '../../src/drivers/port.ts'
import type { Logger } from '../../src/drivers/frame-logger.ts'
import type { ContentSnapshot, SequenceRange } from '../../src/domain/print-job.ts'

export const silentLogger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
}

export interface FakeDriverOptions {
  unreachable?: boolean
  /** Remaining stock, or null when the model cannot report it (FR-016). */
  remainingLabels?: number | null
  blockers?: number[]
  /** Throw from `printPages` once this many pages have gone out. */
  failAfterPages?: { pages: number; error: Error }
  /** Milliseconds each page takes, for observing overlap. */
  pageDelayMs?: number
}

export class FakePrinterDriver implements PrinterDriver {
  readonly kind = 'niimbot' as const
  readonly calls: string[] = []
  pagesRequested = 0
  connectCount = 0
  disconnectCount = 0
  lastOptions: PrintOptions | null = null

  readonly #options: FakeDriverOptions

  constructor(options: FakeDriverOptions = {}) {
    this.#options = options
  }

  async connect(): Promise<void> {
    this.connectCount += 1
    this.calls.push('connect')
    if (this.#options.unreachable === true) {
      throw new PrinterUnreachableError('/dev/fake')
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1
    this.calls.push('disconnect')
  }

  async probe(): Promise<never> {
    throw new Error('probe is not used by the queue')
  }

  async preflight(requestedCopies: number): Promise<PreflightResult> {
    this.calls.push('preflight')
    const remaining = this.#options.remainingLabels
    const blockers = (this.#options.blockers ?? []) as PreflightResult['blockers']
    const remainingLabels = remaining === undefined ? null : remaining
    return {
      ok: blockers.length === 0 && (remainingLabels === null || remainingLabels >= requestedCopies),
      remainingLabels,
      blockers,
    }
  }

  async printPages(
    pages: BinaryBitmap[],
    options: PrintOptions,
    onProgress: (pagesPrinted: number) => void,
  ): Promise<void> {
    this.calls.push('printPages')
    this.pagesRequested = pages.length
    this.lastOptions = options

    for (let index = 0; index < pages.length; index += 1) {
      const failure = this.#options.failAfterPages
      if (failure !== undefined && index === failure.pages) {
        throw failure.error
      }
      if (this.#options.pageDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, this.#options.pageDelayMs))
      }
      onProgress(index + 1)
    }
  }
}

export interface Harness {
  db: Database
  jobs: JobRepo
  printers: PrinterRepo
  queue: PrintQueue
  drivers: Map<string, FakePrinterDriver>
  seedPrinter: (name?: string) => string
  enqueue: (
    printerId: string,
    copies: number,
    extra?: Partial<{ seqRanges: Record<string, SequenceRange>; snapshot: ContentSnapshot }>,
  ) => string
  renderCalls: number[]
  /** The correction each render was asked for, in call order. */
  renderOffsets: { offsetXDots: number; offsetYDots: number }[]
}

export const SNAPSHOT: ContentSnapshot = {
  templateName: null,
  printerName: 'fake',
  printerModel: 'B3S_P',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  ir: { widthMm: 50, heightMm: 30, dpi: 203, elements: [] },
  profile: { name: null, density: 3, labelType: 1 }, offsetXDots: 0, offsetYDots: 0,
}

const BLANK_PAGE: BinaryBitmap = { widthDots: 8, heightDots: 1, data: new Uint8Array(1) }

export function createHarness(driverOptions: (printerId: string) => FakeDriverOptions = () => ({})): Harness {
  const db = openDatabase({ location: ':memory:' })
  const clock = new FixedClock('2026-08-21T00:00:00Z')
  const ids = new SequentialIdGenerator('x')
  const jobs = new JobRepo({ db, clock, ids })
  const printers = new PrinterRepo({ db, clock, ids })
  const drivers = new Map<string, FakePrinterDriver>()
  const renderCalls: number[] = []
  const renderOffsets: { offsetXDots: number; offsetYDots: number }[] = []

  const queue = new PrintQueue({
    jobs,
    printers,
    clock,
    logger: silentLogger,
    createDriver: (printerId) => {
      const driver = new FakePrinterDriver(driverOptions(printerId))
      drivers.set(printerId, driver)
      return driver
    },
    renderPage: (_ir, offset) => {
      renderCalls.push(renderCalls.length)
      // Recorded rather than ignored: a stub that swallows its arguments
      // cannot notice one going missing, which is how the position correction
      // came to be applied on the preview path and nowhere else.
      renderOffsets.push(offset)
      return BLANK_PAGE
    },
  })

  let seq = 0

  return {
    db,
    jobs,
    printers,
    queue,
    drivers,
    renderCalls,
    renderOffsets,
    seedPrinter: (name = 'fake') => {
      const printer = printers.create({
        name,
        kind: 'niimbot',
        transport: 'serial',
        address: '/dev/fake',
        printTaskName: 'B1',
      })
      printers.saveCapabilities(printer.id, {
        dpi: 203,
        printheadPixels: 576,
        densityMin: 1,
        densityMax: 5,
        densityDefault: 3,
        paperTypes: [1],
        printDirection: 'top',
        supportsConsumableLevel: true,
        model: 'B3S_P',
        serial: null,
        firmwareVersion: null,
      })
      return printer.id
    },
    enqueue: (printerId, copies, extra = {}) => {
      seq += 1
      const { job } = jobs.createOrGet({
        idempotencyKey: `key-${seq}`,
        printerId,
        requestedCopies: copies,
        manualFieldValues: {},
        seqRanges: extra.seqRanges ?? {},
        snapshot: extra.snapshot ?? SNAPSHOT,
      })
      return job.id
    },
  }
}

export { PrinterDeviceError }
