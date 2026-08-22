/**
 * Honeywell PC310T driver, speaking ZPL over raw TCP 9100.
 *
 * Simpler than the NIIMBOT link in every respect: no driver, no CUPS, no
 * spooler — open a socket, stream the label, close. The printer is not even
 * attached to this machine.
 *
 * Two behaviours are deliberate rather than incidental:
 *
 *   - **labels go one at a time.** Firing a hundred at once would overrun the
 *     receive buffer on a device with no flow control worth relying on, and it
 *     would collapse progress reporting into "sent everything, no idea".
 *   - **no consumable count.** ZSim's `~HS` says whether paper is out, never
 *     how much is left. So `remainingLabels` is null and FR-016 applies: print
 *     anyway, and make sure the UI says this model cannot warn in advance.
 */
import {
  PrinterDeviceError,
  PrinterUnreachableError,
  type PreflightResult,
  type PrinterCapabilities,
  type PrinterDriver,
  type PrintOptions,
  type ProgressHandler,
  type PrinterTransport,
  type PageSource,
} from '../port.ts'
import { HOST_STATUS_QUERY, buildLabel, parseHostStatus, type GraphicEncoding } from './zpl-builder.ts'

/** PC310T at 203 dpi: 4 inches across. */
export const PC310T_CAPABILITIES: PrinterCapabilities = {
  dpi: 203,
  printheadPixels: 832,
  // ZPL darkness runs 0-30; profiles express 1-5 like the NIIMBOT side and the
  // driver scales, so one density scale serves both printers (Principle III.0).
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: [1],
  printDirection: 'top',
  // ~HS reports "paper out", never "how much is left" (FR-016).
  supportsConsumableLevel: false,
  model: 'PC310T',
  serial: null,
  firmwareVersion: null,
}

export interface ZplDriverOptions {
  transport: PrinterTransport
  address: string
  /** Overridden once hardware verification #4 settles whether ZSim takes Z64. */
  encoding?: GraphicEncoding
  /** How long to wait for a `~HS` reply before giving up on it. */
  statusTimeoutMs?: number
  capabilities?: Partial<PrinterCapabilities>
}

const DEFAULT_STATUS_TIMEOUT_MS = 2000
const ZPL_DARKNESS_MAX = 30

/** Map the shared 1-5 density scale onto ZPL's 0-30 darkness. */
export function densityToDarkness(density: number, min: number, max: number): number {
  if (max <= min) {
    return Math.round(ZPL_DARKNESS_MAX / 2)
  }
  const ratio = (density - min) / (max - min)
  return Math.round(Math.min(1, Math.max(0, ratio)) * ZPL_DARKNESS_MAX)
}

export class ZplDriver implements PrinterDriver {
  readonly kind = 'zpl' as const

  readonly #options: ZplDriverOptions
  #connected = false

  constructor(options: ZplDriverOptions) {
    this.#options = options
  }

  async connect(): Promise<void> {
    try {
      await this.#options.transport.open()
    } catch (err) {
      // No internal retry (FR-047): the queue decides.
      throw err instanceof PrinterUnreachableError
        ? err
        : new PrinterUnreachableError(this.#options.address, err)
    }
    this.#connected = true
  }

  async disconnect(): Promise<void> {
    this.#connected = false
    try {
      await this.#options.transport.close()
    } catch {
      // Releasing must not mask whatever caused us to release.
    }
  }

  #require(): PrinterTransport {
    if (!this.#connected) {
      throw new PrinterUnreachableError(this.#options.address, new Error('not connected'))
    }
    return this.#options.transport
  }

  /**
   * ZSim has no capability query, so these come from the model rather than the
   * wire. Unlike the NIIMBOT path this is a lookup, not a probe — but it is
   * still a single table entry rather than numbers scattered through the code.
   */
  async probe(): Promise<PrinterCapabilities> {
    this.#require()
    return { ...PC310T_CAPABILITIES, ...this.#options.capabilities }
  }

  /** Ask the printer how it is. Silence is treated as "fine". */
  async #hostStatus(): Promise<ReturnType<typeof parseHostStatus> | null> {
    const transport = this.#require()

    return new Promise((resolve) => {
      let buffer = ''
      const unsubscribe = transport.onData((chunk) => {
        buffer += new TextDecoder().decode(chunk)
        if (buffer.includes('\x03') || buffer.split(',').length >= 12) {
          finish()
        }
      })

      const timer = setTimeout(() => finish(), this.#options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS)

      const finish = (): void => {
        clearTimeout(timer)
        unsubscribe()
        // A status query that cannot be read must not become a print failure
        // on a printer that is actually fine.
        resolve(buffer.length === 0 ? null : parseHostStatus(buffer))
      }

      void transport.write(new TextEncoder().encode(HOST_STATUS_QUERY)).catch(() => finish())
    })
  }

  /**
   * The copy count is part of the interface but unused here: this printer can
   * only say whether it has paper, never how much (FR-016).
   */
  async preflight(_requestedCopies: number): Promise<PreflightResult> {
    const status = await this.#hostStatus()
    const blockers: PreflightResult['blockers'] = []

    if (status !== null) {
      if (status.paperOut) {
        blockers.push(2) // LackPaper
      }
      if (status.headUp) {
        blockers.push(1) // CoverOpen
      }
      if (status.ribbonOut) {
        blockers.push(13) // NoRibbon
      }
    }

    return {
      ok: blockers.length === 0,
      // FR-016: this model cannot say how much stock is left, only whether it
      // has run out. The UI has to make that limitation visible.
      remainingLabels: null,
      blockers,
    }
  }

  async printPages(
    pages: PageSource,
    options: PrintOptions,
    onProgress: ProgressHandler,
  ): Promise<void> {
    const transport = this.#require()
    const encoder = new TextEncoder()
    const darkness = densityToDarkness(
      options.density,
      PC310T_CAPABILITIES.densityMin,
      PC310T_CAPABILITIES.densityMax,
    )

    for (let index = 0; index < pages.total; index += 1) {
      // Rendered here rather than before the loop: the first label starts
      // coming out after one render, not after all of them.
      const page = pages.at(index)

      const zpl = buildLabel(page, {
        darkness: index === 0 ? darkness : undefined,
        encoding: this.#options.encoding ?? 'z64',
      })

      try {
        // One label per write. Sending the whole batch at once would overrun
        // the receive buffer and reduce progress to a single "sent it all".
        await transport.write(encoder.encode(zpl))
      } catch (err) {
        throw new PrinterDeviceError(
          `failed to send label ${index + 1} of ${pages.total}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      onProgress(index + 1)
    }
  }
}
