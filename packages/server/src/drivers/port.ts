/**
 * Driver layer ports — the architecture's testing fulcrum.
 *
 * Constitution Principle II: "all code that depends on printer hardware MUST
 * inject the transport layer so tests can substitute a fake; the default test
 * suite MUST pass with no physical device attached."
 *
 * The rule that follows from it: **nothing outside `drivers/` performs I/O.**
 * The queue, the domain layer and the API only ever see `PrinterDriver`.
 */
import type { PrinterErrorCode } from '@mmote/niimbluelib'

/** Byte-stream transport. Understands no printer protocol whatsoever. */
export interface PrinterTransport {
  open(): Promise<void>
  close(): Promise<void>
  write(data: Uint8Array): Promise<void>
  /** Subscribe to inbound bytes. Returns an unsubscribe function. */
  onData(handler: (chunk: Uint8Array) => void): () => void
  readonly isOpen: boolean
}

/** A binarised page. 1 means "burn a dot", 0 means "leave blank". */
export interface BinaryBitmap {
  widthDots: number
  heightDots: number
  /** One bit per pixel, row-major, most significant bit leftmost. */
  data: Uint8Array
}

export interface PrinterCapabilities {
  dpi: number
  printheadPixels: number
  densityMin: number
  densityMax: number
  densityDefault: number
  paperTypes: number[]
  printDirection: 'top' | 'left'
  /**
   * Whether the device can report remaining stock. Decides between FR-015
   * (refuse before printing anything) and FR-016 (skip the check, warn the
   * user that this model cannot give advance notice).
   */
  supportsConsumableLevel: boolean
  model: string | null
  serial: string | null
  firmwareVersion: string | null
}

export interface PreflightResult {
  ok: boolean
  /** Remaining labels, or null when the device cannot report it (FR-016). */
  remainingLabels: number | null
  /** Reasons the device cannot print right now, mapped to copy by the i18n layer. */
  blockers: PrinterErrorCode[]
}

export interface PrintOptions {
  density: number
  labelType: number
  speed?: number
  printDirection: 'top' | 'left'
}

export type ProgressHandler = (pagesPrinted: number) => void

/**
 * The pages of one job, produced on demand.
 *
 * An array used to be handed over instead, which meant a thousand-label job
 * rendered a thousand bitmaps — twelve megabytes of them, all resident — before
 * the first label could start coming out. The wait grew with the batch, and
 * during it there was nothing to distinguish "working" from "hung".
 *
 * `total` is here rather than left to be counted because drivers genuinely need
 * it up front: TSPL's PRINT command carries it, progress is reported against
 * it, and the printed count is measured from it. That is why this is not an
 * `Iterable`, which cannot say how many.
 *
 * `at` is synchronous because rendering is. An `AsyncIterable` would make the
 * whole path async — the queue, four drivers, the render callback — in exchange
 * for nothing, since there is no I/O to wait on.
 */
export interface PageSource {
  readonly total: number
  /** Render (or return) the page at this index. Indices are 0-based. */
  at(index: number): BinaryBitmap
}

export interface PrinterDriver {
  readonly kind: 'niimbot' | 'zpl'
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Probe capability parameters (FR-025). */
  probe(): Promise<PrinterCapabilities>
  /** Check the device can print right now (FR-014, FR-015). */
  preflight(requestedCopies: number): Promise<PreflightResult>
  /**
   * Print each page in order, reporting progress between pages.
   *
   * Drivers MUST take pages one at a time. Draining the source up front would
   * put the wait back exactly where it was, with the streaming machinery in
   * place and none of its benefit.
   */
  printPages(
    pages: PageSource,
    options: PrintOptions,
    onProgress: ProgressHandler,
  ): Promise<void>
}

/**
 * The device could not be reached at all — powered off, unplugged, wrong
 * address. Distinct from a device that answered and refused, because this is
 * the only failure class that needs somebody to walk over to the machine.
 *
 * Drivers MUST NOT retry internally (FR-047): the queue decides.
 */
export class PrinterUnreachableError extends Error {
  readonly address: string
  override readonly cause?: unknown

  constructor(address: string, cause?: unknown) {
    super(`printer at ${address} is unreachable`)
    this.name = 'PrinterUnreachableError'
    this.address = address
    this.cause = cause
  }
}

/** The device answered but rejected the operation. */
export class PrinterDeviceError extends Error {
  readonly reasonId: number | undefined

  constructor(message: string, reasonId?: number) {
    super(message)
    this.name = 'PrinterDeviceError'
    this.reasonId = reasonId
  }
}
