/**
 * USB CDC serial transport (NIIMBOT B3S_P on /dev/ttyACM0).
 *
 * Connections are opened per job and closed again — see contracts/driver-port.md.
 * That also sidesteps the printer's one-hour idle shutdown: a sleeping device
 * simply fails to open, which is reported honestly, instead of a live
 * connection dying halfway through a reconnect state machine.
 */
import { SerialPort } from 'serialport'
import { PrinterUnreachableError, type PrinterTransport } from './port.ts'

export interface SerialTransportOptions {
  path: string
  baudRate?: number
  openTimeoutMs?: number
}

const DEFAULT_BAUD_RATE = 115200
const DEFAULT_OPEN_TIMEOUT_MS = 5000

export class SerialTransport implements PrinterTransport {
  readonly #options: Required<SerialTransportOptions>
  #port: SerialPort | undefined

  constructor(options: SerialTransportOptions) {
    this.#options = {
      path: options.path,
      baudRate: options.baudRate ?? DEFAULT_BAUD_RATE,
      openTimeoutMs: options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS,
    }
  }

  get isOpen(): boolean {
    return this.#port?.isOpen ?? false
  }

  async open(): Promise<void> {
    const port = new SerialPort({
      path: this.#options.path,
      baudRate: this.#options.baudRate,
      autoOpen: false,
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // No internal retry (FR-047): the queue decides what happens next.
        reject(new PrinterUnreachableError(this.#options.path, new Error('open timed out')))
      }, this.#options.openTimeoutMs)

      port.open((err) => {
        clearTimeout(timer)
        if (err) {
          reject(new PrinterUnreachableError(this.#options.path, err))
          return
        }
        resolve()
      })
    })

    this.#port = port
  }

  async close(): Promise<void> {
    const port = this.#port
    this.#port = undefined
    if (port === undefined || !port.isOpen) {
      return
    }
    await new Promise<void>((resolve) => {
      port.close(() => resolve())
    })
  }

  async write(data: Uint8Array): Promise<void> {
    const port = this.#port
    if (port === undefined || !port.isOpen) {
      throw new PrinterUnreachableError(this.#options.path, new Error('transport is not open'))
    }
    await new Promise<void>((resolve, reject) => {
      port.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()))
    })
  }

  onData(handler: (chunk: Uint8Array) => void): () => void {
    const port = this.#port
    if (port === undefined) {
      throw new Error('cannot subscribe before the transport is open')
    }
    const listener = (chunk: Buffer): void => handler(new Uint8Array(chunk))
    port.on('data', listener)
    return () => {
      port.off('data', listener)
    }
  }
}
