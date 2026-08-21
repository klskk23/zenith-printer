/**
 * Driver construction from a stored printer record.
 *
 * The only place that knows how a `Printer` row becomes a live driver, so the
 * queue and the API can stay ignorant of both protocols.
 */
import { NiimbotNodeSerialClient, type PrintTaskName } from '@mmote/niimbluelib'
import type { Printer } from '../domain/printer.ts'
import { NiimbotDriver } from './niimbot/niimbot-driver.ts'
import { createPacketFrameLogger, type Logger } from './frame-logger.ts'
import type { PrinterDriver } from './port.ts'
import { DryRunDriver } from './dry-run/dry-run-driver.ts'
import { ZplDriver } from './zpl/zpl-driver.ts'
import { TcpTransport } from './tcp-transport.ts'
import { withFrameLogging } from './frame-logger.ts'

export interface DriverFactoryDeps {
  logger: Logger
  jobId?: string
  /**
   * Never touch real hardware. Set from ZENITH_DRY_RUN.
   * Exists because a development test once found a real printer plugged in and
   * printed actual labels; a switch beats remembering.
   */
  dryRun?: boolean
}

/**
 * Whether real hardware is off limits.
 *
 * Two independent reasons, and the second is not optional:
 *
 *   1. ZENITH_DRY_RUN — a deliberate choice for demos and UI work.
 *   2. Running under a test runner. Constitution Principle II requires the
 *      default suite to pass with no printer attached, which also means it
 *      must not *use* one that happens to be attached. A suite that reaches a
 *      plugged-in printer produces labels nobody asked for, and discovering
 *      that after the fact is exactly what this guard prevents.
 *
 * The second check cannot be forgotten, which is the point of putting it here
 * rather than in each test's setup.
 */
export function isDryRunEnabled(): boolean {
  const flag = process.env.ZENITH_DRY_RUN
  if (flag === '1' || flag === 'true') {
    return true
  }
  return process.env.VITEST !== undefined || process.env.NODE_ENV === 'test'
}

export class UnsupportedPrinterKindError extends Error {
  readonly kind: string

  constructor(kind: string) {
    super(`no driver is registered for printer kind "${kind}"`)
    this.name = 'UnsupportedPrinterKindError'
    this.kind = kind
  }
}

/** `192.168.1.50:9100` or a bare host, which falls back to the raw print port. */
export function splitAddress(address: string): [string, number | undefined] {
  const separator = address.lastIndexOf(':')
  if (separator === -1) {
    return [address, undefined]
  }
  const port = Number(address.slice(separator + 1))
  return Number.isInteger(port) && port > 0
    ? [address.slice(0, separator), port]
    : [address, undefined]
}

export function createDriver(printer: Printer, deps: DriverFactoryDeps): PrinterDriver {
  const frameLogger = createPacketFrameLogger(deps.logger, {
    printerId: printer.id,
    ...(deps.jobId === undefined ? {} : { jobId: deps.jobId }),
  })

  if (deps.dryRun === true || isDryRunEnabled()) {
    return new DryRunDriver({
      kind: printer.kind,
      printerId: printer.id,
      ...(deps.jobId === undefined ? {} : { jobId: deps.jobId }),
      logger: deps.logger,
      ...(printer.capabilities === null ? {} : { capabilities: printer.capabilities }),
    })
  }

  if (printer.kind === 'niimbot') {
    if (printer.printTaskName === undefined) {
      throw new Error(`printer ${printer.id} has no print task configured`)
    }
    return new NiimbotDriver({
      address: printer.address,
      printTaskName: printer.printTaskName as PrintTaskName,
      frameLogger,
      createClient: () => {
        const client = new NiimbotNodeSerialClient()
        client.setPort(printer.address)
        return client
      },
    })
  }

  if (printer.kind === 'zpl') {
    const [host, port] = splitAddress(printer.address)
    // We own this socket, so the frame logger wraps it directly — unlike the
    // NIIMBOT path, where niimbluelib holds the port and frames come from its
    // own events instead.
    const transport = withFrameLogging(
      new TcpTransport({ host, ...(port === undefined ? {} : { port }) }),
      deps.logger,
      { printerId: printer.id, ...(deps.jobId === undefined ? {} : { jobId: deps.jobId }) },
      // ZPL is text; hex would make the log unreadable for no benefit.
      { encoding: 'text' },
    )
    return new ZplDriver({ transport, address: printer.address })
  }

  throw new UnsupportedPrinterKindError(printer.kind)
}
