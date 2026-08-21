/**
 * Protocol frame logging.
 *
 * Constitution Principle V: "every exchange with the printer MUST be
 * recordable as a hex frame at debug level."
 *
 * Note where this lives. Putting it in each driver would mean writing it twice
 * and, worse, missing the paths nobody thinks about — reconnects, probes,
 * heartbeats. Wrapping the transport puts it at the single point every byte
 * passes through, so "every exchange" is structural rather than a discipline
 * people have to remember.
 *
 * The ZPL driver gets the same capability for free.
 */
import type { PrinterTransport } from './port.ts'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface Logger {
  debug(payload: Record<string, unknown>, message: string): void
  info(payload: Record<string, unknown>, message: string): void
  readonly level: LogLevel
}

export interface FrameLogContext {
  printerId: string
  jobId?: string
}

export interface FrameLoggingOptions {
  /** Text protocols (ZPL) are logged verbatim; binary ones as hex. */
  encoding?: 'hex' | 'text'
  /** Frames longer than this are truncated with a marker. */
  maxBytes?: number
}

export const DEFAULT_MAX_BYTES = 512

/** Identifiers that must be masked above debug level. */
const SERIAL_PATTERN = /\b[A-Z]\d{9}\b/g
const MAC_PATTERN = /\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g

/**
 * Mask device identifiers. They are permitted at debug level, where they are
 * needed to correlate a capture with a specific unit, and masked above it.
 */
export function redactIdentifiers(value: string): string {
  return value.replace(SERIAL_PATTERN, '***REDACTED***').replace(MAC_PATTERN, '**:**:**:**:**:**')
}

export function toHex(data: Uint8Array, maxBytes: number = DEFAULT_MAX_BYTES): string {
  const slice = data.subarray(0, maxBytes)
  const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join('')
  return data.length > maxBytes ? `${hex}...(${data.length} bytes total)` : hex
}

function toText(data: Uint8Array, maxBytes: number): string {
  const text = new TextDecoder().decode(data.subarray(0, maxBytes))
  return data.length > maxBytes ? `${text}...(${data.length} bytes total)` : text
}

/** Wrap a transport so every byte in and out is recorded at debug level. */
export function withFrameLogging(
  inner: PrinterTransport,
  logger: Logger,
  context: FrameLogContext,
  options: FrameLoggingOptions = {},
): PrinterTransport {
  const encoding = options.encoding ?? 'hex'
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const format = encoding === 'text' ? toText : toHex

  const shouldLogFrames = (): boolean => logger.level === 'debug'

  const record = (direction: '>>' | '<<', data: Uint8Array): void => {
    if (!shouldLogFrames()) {
      // Frame contents never appear above debug level.
      return
    }
    logger.debug(
      {
        printerId: context.printerId,
        jobId: context.jobId,
        direction,
        bytes: data.length,
        frame: format(data, maxBytes),
      },
      'printer frame',
    )
  }

  return {
    get isOpen() {
      return inner.isOpen
    },
    async open() {
      await inner.open()
      logger.debug({ printerId: context.printerId, jobId: context.jobId }, 'transport opened')
    },
    async close() {
      await inner.close()
      logger.debug({ printerId: context.printerId, jobId: context.jobId }, 'transport closed')
    },
    async write(data: Uint8Array) {
      record('>>', data)
      await inner.write(data)
    },
    onData(handler: (chunk: Uint8Array) => void) {
      return inner.onData((chunk) => {
        record('<<', chunk)
        handler(chunk)
      })
    },
  }
}

/**
 * Frame logging for a transport we do NOT own.
 *
 * niimbluelib opens its own serial port, so `withFrameLogging` never sees the
 * NIIMBOT link. Principle V says *every* exchange must be recordable, so that
 * path subscribes to the library's own `packetsent` / `packetreceived` events
 * and formats them identically. Same output, two sources, because the byte
 * stream has two owners.
 */
export interface PacketFrameLogger {
  sent(bytes: Uint8Array): void
  received(bytes: Uint8Array): void
}

export function createPacketFrameLogger(
  logger: Logger,
  context: FrameLogContext,
  options: FrameLoggingOptions = {},
): PacketFrameLogger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const record = (direction: '>>' | '<<', bytes: Uint8Array): void => {
    if (logger.level !== 'debug') {
      return
    }
    logger.debug(
      {
        printerId: context.printerId,
        jobId: context.jobId,
        direction,
        bytes: bytes.length,
        frame: toHex(bytes, maxBytes),
      },
      'printer frame',
    )
  }

  return {
    sent: (bytes) => record('>>', bytes),
    received: (bytes) => record('<<', bytes),
  }
}
