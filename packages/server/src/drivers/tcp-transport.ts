/**
 * Raw TCP transport (Honeywell PC310T on port 9100).
 *
 * Nothing exotic: open a socket, stream the print-ready payload, close. No
 * driver, no CUPS, no spooler — which makes this the simpler of the two links
 * despite the printer not being attached to this machine at all.
 */
import { Socket } from 'node:net'
import { PrinterUnreachableError, type PrinterTransport } from './port.ts'

export interface TcpTransportOptions {
  host: string
  port?: number
  connectTimeoutMs?: number
}

export const RAW_PRINT_PORT = 9100
const DEFAULT_CONNECT_TIMEOUT_MS = 5000

export class TcpTransport implements PrinterTransport {
  readonly #options: Required<TcpTransportOptions>
  #socket: Socket | undefined

  constructor(options: TcpTransportOptions) {
    this.#options = {
      host: options.host,
      port: options.port ?? RAW_PRINT_PORT,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    }
  }

  get address(): string {
    return `${this.#options.host}:${this.#options.port}`
  }

  get isOpen(): boolean {
    return this.#socket !== undefined && !this.#socket.destroyed
  }

  async open(): Promise<void> {
    const socket = new Socket()
    socket.setTimeout(this.#options.connectTimeoutMs)

    await new Promise<void>((resolve, reject) => {
      const fail = (cause: unknown): void => {
        socket.destroy()
        reject(new PrinterUnreachableError(this.address, cause))
      }
      socket.once('error', fail)
      socket.once('timeout', () => fail(new Error('connect timed out')))
      socket.connect(this.#options.port, this.#options.host, () => {
        socket.setTimeout(0)
        socket.off('error', fail)
        resolve()
      })
    })

    this.#socket = socket
  }

  async close(): Promise<void> {
    const socket = this.#socket
    this.#socket = undefined
    if (socket === undefined || socket.destroyed) {
      return
    }
    await new Promise<void>((resolve) => {
      socket.end(() => {
        socket.destroy()
        resolve()
      })
    })
  }

  async write(data: Uint8Array): Promise<void> {
    const socket = this.#socket
    if (socket === undefined || socket.destroyed) {
      throw new PrinterUnreachableError(this.address, new Error('transport is not open'))
    }
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()))
    })
  }

  onData(handler: (chunk: Uint8Array) => void): () => void {
    const socket = this.#socket
    if (socket === undefined) {
      throw new Error('cannot subscribe before the transport is open')
    }
    const listener = (chunk: Buffer): void => handler(new Uint8Array(chunk))
    socket.on('data', listener)
    return () => {
      socket.off('data', listener)
    }
  }
}
