/**
 * A driver that goes through every motion except burning paper.
 *
 * Added after a development test was pointed at a real, freshly plugged-in
 * printer and produced actual labels. Remembering not to do that is not a
 * safeguard; a switch is.
 *
 * It is also useful on its own: demos, UI work and end-to-end checks all want
 * the full request path without consuming stock.
 *
 * Enable with ZENITH_DRY_RUN=1.
 */
import type {
  BinaryBitmap,
  PreflightResult,
  PrinterCapabilities,
  PrinterDriver,
  PrintOptions,
  ProgressHandler,
} from '../port.ts'
import type { Logger } from '../frame-logger.ts'

export interface DryRunOptions {
  kind: 'niimbot' | 'zpl'
  printerId: string
  jobId?: string
  logger: Logger
  /** Milliseconds per page, so progress reporting behaves realistically. */
  pageDelayMs?: number
  capabilities?: Partial<PrinterCapabilities>
}

/**
 * Kind-appropriate stand-ins.
 *
 * Not one shared set of numbers: the two heads differ in width (576 vs 832
 * dots) and in whether they can report remaining stock, and both differences
 * drive visible behaviour — the canvas width limit and the "cannot warn you
 * before running out" notice. A dry run that flattened them would let UI work
 * proceed against capabilities no real printer has.
 */
const DEFAULT_CAPABILITIES: Record<'niimbot' | 'zpl', PrinterCapabilities> = {
  niimbot: {
    dpi: 203,
    printheadPixels: 576,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1, 2, 3, 5],
    printDirection: 'top',
    supportsConsumableLevel: true,
    model: 'B3S_P (dry run)',
    serial: null,
    firmwareVersion: null,
  },
  zpl: {
    dpi: 203,
    printheadPixels: 832,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1],
    printDirection: 'top',
    // ~HS reports "paper out", never how much is left (FR-016).
    supportsConsumableLevel: false,
    model: 'PC310T (dry run)',
    serial: null,
    firmwareVersion: null,
  },
}

export class DryRunDriver implements PrinterDriver {
  readonly kind: 'niimbot' | 'zpl'
  readonly #options: DryRunOptions

  constructor(options: DryRunOptions) {
    this.kind = options.kind
    this.#options = options
  }

  async connect(): Promise<void> {
    this.#options.logger.info(
      { printerId: this.#options.printerId, jobId: this.#options.jobId },
      'dry run: pretending to connect',
    )
  }

  async disconnect(): Promise<void> {}

  async probe(): Promise<PrinterCapabilities> {
    return { ...DEFAULT_CAPABILITIES[this.kind], ...this.#options.capabilities }
  }

  /** The copy count is part of the interface; a dry run has nothing to check. */
  async preflight(_requestedCopies: number): Promise<PreflightResult> {
    return {
      ok: true,
      // Null on both kinds: a dry run cannot invent a stock count, and
      // pretending otherwise would hide the FR-016 path during UI work.
      remainingLabels: null,
      blockers: [],
    }
  }

  async printPages(
    pages: BinaryBitmap[],
    options: PrintOptions,
    onProgress: ProgressHandler,
  ): Promise<void> {
    this.#options.logger.info(
      {
        printerId: this.#options.printerId,
        jobId: this.#options.jobId,
        pages: pages.length,
        density: options.density,
        sizeDots: pages[0] === undefined ? null : `${pages[0].widthDots}x${pages[0].heightDots}`,
      },
      'dry run: would have printed',
    )

    for (let index = 0; index < pages.length; index += 1) {
      if (this.#options.pageDelayMs !== undefined && this.#options.pageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.#options.pageDelayMs))
      }
      onProgress(index + 1)
    }
  }
}
