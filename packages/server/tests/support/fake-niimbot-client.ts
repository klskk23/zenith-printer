/**
 * A stand-in for niimbluelib's client.
 *
 * Constitution Principle II: the default suite must pass with no printer
 * attached. The real client opens a serial port in its constructor path, so the
 * driver takes a factory and tests supply this instead.
 *
 * It records what the driver asked for, so assertions can check the encoded
 * page data and the call order without a device.
 */
import { EventEmitter } from 'node:events'
import type { EncodedImage } from '@mmote/niimbluelib'

export interface FakeClientOptions {
  connectError?: Error
  /** Metadata returned by `getModelMetadata()`; undefined models a probe failure. */
  metadata?: Record<string, unknown>
  printerInfo?: Record<string, unknown>
  /**
   * Errors thrown by successive `fetchPrinterInfo()` calls; `undefined` at a
   * position means that attempt succeeds. Models the real failure this exists
   * for: niimbluelib's connect() calls fetchPrinterInfo() inside a try/catch
   * that only console.errors, so a device that negotiated and then failed on
   * the model-id packet looks connected and has no model.
   */
  fetchInfoErrors?: Array<Error | undefined>
  /** Metadata exposed once `fetchPrinterInfo()` has succeeded. */
  metadataAfterFetch?: Record<string, unknown>
  heartbeat?: { paperInserted?: boolean; lidClosed?: boolean }
  rfid?: { tagPresent: boolean; allPaper: number; usedPaper: number }
  rfidError?: Error
  /** Throw from `printPage` at this zero-based index. */
  failOnPage?: { index: number; error: Error }
}

export interface RecordedCall {
  name: string
  args: unknown[]
}

export class FakeNiimbotClient extends EventEmitter {
  readonly calls: RecordedCall[] = []
  readonly printedPages: EncodedImage[] = []
  connectCount = 0
  disconnectCount = 0
  printEndCount = 0
  fetchInfoCount = 0

  readonly #options: FakeClientOptions
  #metadata: Record<string, unknown> | undefined

  constructor(options: FakeClientOptions = {}) {
    super()
    this.#options = options
    this.#metadata = options.metadata
  }

  #record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args })
  }

  async connect(): Promise<void> {
    this.connectCount += 1
    this.#record('connect')
    if (this.#options.connectError) {
      throw this.#options.connectError
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1
    this.#record('disconnect')
  }

  getModelMetadata(): Record<string, unknown> | undefined {
    return this.#metadata
  }

  async fetchPrinterInfo(): Promise<Record<string, unknown>> {
    const error = this.#options.fetchInfoErrors?.[this.fetchInfoCount]
    this.fetchInfoCount += 1
    this.#record('fetchPrinterInfo')
    if (error !== undefined) {
      throw error
    }
    if (this.#options.metadataAfterFetch !== undefined) {
      this.#metadata = this.#options.metadataAfterFetch
    }
    return this.#options.printerInfo ?? {}
  }

  getPrinterInfo(): Record<string, unknown> | undefined {
    return this.#options.printerInfo
  }

  get abstraction(): Record<string, unknown> {
    // Arrow functions so `this` stays lexical; aliasing it would be one more
    // thing to keep in sync.
    return {
      heartbeat: async () => {
        this.#record('heartbeat')
        return this.#options.heartbeat ?? { paperInserted: true, lidClosed: true }
      },
      rfidInfo: async () => {
        this.#record('rfidInfo')
        if (this.#options.rfidError) {
          throw this.#options.rfidError
        }
        return this.#options.rfid ?? { tagPresent: true, allPaper: 100, usedPaper: 0 }
      },
      newPrintTask: (name: string, options: Record<string, unknown>) => {
        this.#record('newPrintTask', name, options)
        return {
          printInit: async () => {
            this.#record('printInit')
          },
          printPage: async (image: EncodedImage, quantity: number) => {
            const index = this.printedPages.length
            const failure = this.#options.failOnPage
            if (failure && failure.index === index) {
              throw failure.error
            }
            this.printedPages.push(image)
            this.#record('printPage', quantity)
          },
          waitForPageFinished: async () => {
            this.#record('waitForPageFinished')
          },
          waitForFinished: async () => {
            this.#record('waitForFinished')
          },
          printEnd: async () => {
            this.printEndCount += 1
            this.#record('printEnd')
            return true
          },
        }
      },
    }
  }

  /** Model a client that stops reporting its model, to reach probe()'s guard. */
  forgetModel(): void {
    this.#metadata = undefined
  }

  /** Order of driver-visible calls, for asserting the print sequence. */
  callNames(): string[] {
    return this.calls.map((call) => call.name)
  }
}

/** Metadata matching a real B3S_P probe (docs/B3S_P.info). */
export const B3SP_METADATA = {
  model: 'B3S_P',
  dpi: 203,
  printDirection: 'top' as const,
  printheadPixels: 576,
  paperTypes: [1, 2, 3, 5],
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
}
