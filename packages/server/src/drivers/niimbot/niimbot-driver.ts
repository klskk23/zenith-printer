/**
 * NIIMBOT driver (B3S_P and relatives), built on niimbluelib.
 *
 * Two deliberate departures from niimblue-node:
 *
 *   1. `initClient` is not used. It funnels `printprogress` and
 *      `heartbeatfailed` into `console.log`, which is fine for a CLI and
 *      useless as a library: those events are the only progress signal a
 *      hundred-copy job has (FR-020, FR-035).
 *   2. The client is constructed here so the transport stays injectable.
 *      Constitution Principle II: the default suite must run with no printer.
 *
 * Connections are per job — open, print, close. That also sidesteps the
 * one-hour idle shutdown: a sleeping printer simply fails to open, and the
 * queue reports that honestly instead of nursing a dead connection.
 */
import {
  ImageEncoder,
  LabelType,
  NiimbotAbstractClient,
  PrintError,
  Utils,
  type PacketReceivedEvent,
  type PacketSentEvent,
  type PrintProgressEvent,
  type PrintTaskName,
} from '@mmote/niimbluelib'
import type { PacketFrameLogger } from '../frame-logger.ts'
import {
  PrinterDeviceError,
  PrinterUnreachableError,
  type PreflightResult,
  type PrinterCapabilities,
  type PrinterDriver,
  type PrintOptions,
  type ProgressHandler,
  type PageSource,
} from '../port.ts'
import { BitmapImageSource } from './bitmap-source.ts'

/** How niimbluelib's client is obtained; swapped for a fake in tests. */
export interface NiimbotClientFactory {
  (): NiimbotAbstractClient
}

export interface NiimbotDriverOptions {
  createClient: NiimbotClientFactory
  printTaskName: PrintTaskName
  address: string
  /** Poll interval while waiting for a page, in milliseconds. */
  statusPollIntervalMs?: number
  statusTimeoutMs?: number
  /**
   * Frame logging for this link. Required because niimbluelib owns its own
   * serial port, so the transport-level wrapper never sees these bytes.
   */
  frameLogger?: PacketFrameLogger
}

/**
 * How many times to ask for the printer info before giving up.
 *
 * Two, not more: each attempt is up to ten sequential packets at a one-second
 * timeout apiece, so a dead printer would otherwise keep somebody waiting at
 * the machine for the better part of a minute.
 */
const INFO_FETCH_ATTEMPTS = 2

export class NiimbotDriver implements PrinterDriver {
  readonly kind = 'niimbot' as const

  readonly #options: NiimbotDriverOptions
  #client: NiimbotAbstractClient | undefined

  constructor(options: NiimbotDriverOptions) {
    this.#options = options
  }

  async connect(): Promise<void> {
    let client: NiimbotAbstractClient
    try {
      // Constructing the client already touches the port, so it belongs
      // inside the guard just as much as connect() does.
      client = this.#options.createClient()
      await client.connect()
    } catch (err) {
      // No internal retry (FR-047): the queue decides what happens next.
      throw new PrinterUnreachableError(this.#options.address, err)
    }

    // niimbluelib's serial client RESOLVES connect() even when nothing is on
    // the other end — the protocol timeouts surface later, asynchronously,
    // outside this promise chain. Measured against a missing /dev/ttyACM0:
    //
    //   connect()          -> resolves
    //   isConnected()      -> true
    //   getPrinterInfo()   -> {}          (empty, but NOT undefined)
    //   getModelMetadata() -> undefined
    //
    // So neither the resolved promise nor `isConnected()` proves anything, and
    // an emptiness check on `getPrinterInfo()` has to look at its contents.
    // A real handshake fills in connectResult and modelId (see
    // docs/B3S_P.info). Getting this wrong turns the product's most common
    // failure — an idle printer that powered itself off — into an opaque
    // internal error instead of "go switch it on".
    if (!NiimbotDriver.#completedHandshake(client)) {
      await client.disconnect().catch(() => undefined)
      throw new PrinterUnreachableError(
        this.#options.address,
        new Error('connected but the device never completed its handshake'),
      )
    }
    // A connection with no model metadata is not usable: probe() needs it for
    // the head width and dpi, and the print task is chosen from it. This is
    // reachable because niimbluelib's connect() runs initialNegotiate() and
    // fetchPrinterInfo() inside ONE try/catch whose catch does nothing but
    // console.error — so a device that negotiates and then fails on the very
    // next packet (the model id, fetchPrinterInfo's first line) arrives here
    // looking connected, with connectResult set, no modelId, and the reason
    // gone. probe() would then report "the printer refused the operation",
    // which is both wrong and unactionable.
    //
    // Redo the fetch. It is the library's own public method, the error reaches
    // us this time, and a device that was busy on the first attempt usually
    // answers on the second.
    if (client.getModelMetadata() === undefined) {
      await this.#recoverModelMetadata(client)
    }

    // Principle V: record every exchange. This link's bytes are inside
    // niimbluelib, so we subscribe to its packet events instead of wrapping
    // a transport we do not own.
    const frameLogger = this.#options.frameLogger
    if (frameLogger !== undefined) {
      client.on('packetsent', (event: PacketSentEvent) =>
        frameLogger.sent(event.packet.toBytes()),
      )
      client.on('packetreceived', (event: PacketReceivedEvent) =>
        frameLogger.received(event.packet.toBytes()),
      )
    }

    this.#client = client
  }

  /**
   * Fetch the printer info again, and say plainly what went wrong if it fails.
   *
   * No delay between attempts: each one is a full round trip that niimbluelib
   * already bounds with its own one-second packet timeout, so the spacing is
   * inherent. Adding a timer would also make this untestable without a clock
   * (constitution: tests MUST be deterministic).
   */
  async #recoverModelMetadata(client: NiimbotAbstractClient): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < INFO_FETCH_ATTEMPTS; attempt += 1) {
      try {
        await client.fetchPrinterInfo()
        lastError = undefined
        break
      } catch (err) {
        lastError = err
      }
      if (client.getModelMetadata() !== undefined) {
        return
      }
    }

    if (lastError !== undefined) {
      await client.disconnect().catch(() => undefined)
      // A device that answered and refused is a different problem from one
      // that never answered, and the two need different instructions: the
      // first is worth power-cycling, the second means walk over and look at
      // it. niimbluelib turns an In_NotSupported or In_PrintError packet into
      // PrintError, which is exactly the "answered and refused" case.
      if (lastError instanceof PrintError) {
        throw new PrinterDeviceError(
          `the printer refused the model-information request: ${lastError.message}`,
        )
      }
      throw new PrinterUnreachableError(this.#options.address, lastError)
    }

    if (client.getModelMetadata() === undefined) {
      // The link is fine and the device is healthy — it named a model this
      // build has no metadata for. Telling somebody to power-cycle a working
      // printer would waste their morning, so the message says the model id
      // instead; that is the number a maintainer needs.
      const modelId = client.getPrinterInfo()?.modelId
      await client.disconnect().catch(() => undefined)
      throw new PrinterDeviceError(
        `the printer reports model id ${modelId ?? 'unknown'}, which this build has no metadata for`,
      )
    }
  }

  /** Whether the client actually completed a protocol handshake. */
  static #completedHandshake(client: NiimbotAbstractClient): boolean {
    if (client.getModelMetadata() !== undefined) {
      return true
    }
    const info = client.getPrinterInfo()
    if (info === undefined) {
      return false
    }
    return info.connectResult !== undefined || info.modelId !== undefined || info.serial !== undefined
  }

  async disconnect(): Promise<void> {
    const client = this.#client
    this.#client = undefined
    if (client === undefined) {
      return
    }
    try {
      await client.disconnect()
    } catch {
      // Releasing must not mask the error that caused us to release.
    }
  }

  #require(): NiimbotAbstractClient {
    if (this.#client === undefined) {
      throw new PrinterUnreachableError(this.#options.address, new Error('not connected'))
    }
    return this.#client
  }

  async probe(): Promise<PrinterCapabilities> {
    const client = this.#require()
    const metadata = client.getModelMetadata()
    const info = client.getPrinterInfo()

    if (metadata === undefined) {
      throw new PrinterDeviceError('printer did not report model metadata')
    }

    return {
      dpi: metadata.dpi,
      printheadPixels: metadata.printheadPixels,
      densityMin: metadata.densityMin,
      densityMax: metadata.densityMax,
      densityDefault: metadata.densityDefault,
      paperTypes: [...metadata.paperTypes],
      printDirection: metadata.printDirection,
      // RFID stock reports how much is left, which turns "ran out mid-job"
      // from something to recover from into something to prevent (FR-015).
      supportsConsumableLevel: true,
      model: metadata.model,
      serial: info?.serial ?? null,
      firmwareVersion: info?.softwareVersion ?? null,
    }
  }

  async preflight(requestedCopies: number): Promise<PreflightResult> {
    const client = this.#require()
    const blockers: PreflightResult['blockers'] = []

    const heartbeat = await client.abstraction.heartbeat()
    if (heartbeat.paperInserted === false) {
      blockers.push(2) // LackPaper
    }
    if (heartbeat.lidClosed === false) {
      blockers.push(1) // CoverOpen
    }

    let remainingLabels: number | null = null
    try {
      const rfid = await client.abstraction.rfidInfo()
      // Measured on B3S_P: third-party stock does NOT raise. It answers
      // normally with tagPresent false and allPaper -1, so emptiness has to be
      // judged from the contents. Reading -1 as a count would report "no stock
      // left" and refuse every job on non-original media.
      if (rfid.tagPresent && rfid.allPaper > 0) {
        remainingLabels = rfid.allPaper - rfid.usedPaper
      }
    } catch {
      // Genuine communication failure. FR-016 still applies: print anyway
      // rather than refusing because the count could not be read.
      remainingLabels = null
    }

    if (remainingLabels !== null && remainingLabels < requestedCopies) {
      return { ok: false, remainingLabels, blockers }
    }

    return { ok: blockers.length === 0, remainingLabels, blockers }
  }

  async printPages(
    pages: PageSource,
    options: PrintOptions,
    onProgress: ProgressHandler,
  ): Promise<void> {
    const client = this.#require()

    const task = client.abstraction.newPrintTask(this.#options.printTaskName, {
      density: options.density,
      labelType: options.labelType as LabelType,
      // Needed before the first page, which is why the source carries a total
      // rather than being something we count by draining it.
      totalPages: pages.total,
      statusPollIntervalMs: this.#options.statusPollIntervalMs ?? 500,
      statusTimeoutMs: this.#options.statusTimeoutMs ?? 8000,
    })

    let printed = 0
    // The only real progress signal for a long job; `initClient` throws it away.
    const onPrintProgress = (event: PrintProgressEvent): void => {
      if (event.pagePrintProgress === 100) {
        printed = Math.max(printed, event.page)
        onProgress(printed)
      }
    }
    client.on('printprogress', onPrintProgress)

    try {
      await task.printInit()
      // Rendered and encoded one page at a time, inside the loop: doing it up
      // front would put the whole batch's wait back before the first label.
      for (let index = 0; index < pages.total; index += 1) {
        const image = ImageEncoder.encode(
          new BitmapImageSource(pages.at(index)),
          options.printDirection,
        )
        await task.printPage(image, 1)
        await task.waitForPageFinished()
      }
      await task.waitForFinished()
    } catch (err) {
      if (err instanceof PrintError) {
        throw new PrinterDeviceError(err.message, err.reasonId)
      }
      throw err
    } finally {
      // Constitution ("Resource safety"): release on success and on failure.
      client.off('printprogress', onPrintProgress)
      await task.printEnd().catch(() => undefined)
    }
  }
}

/** Hex helper for golden-sample diffing in tests and debug logs. */
export function framesToHex(frames: Uint8Array[]): string {
  return frames.map((frame) => Utils.bufToHex(frame, '')).join('')
}
