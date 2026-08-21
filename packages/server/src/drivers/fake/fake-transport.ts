/**
 * In-memory transport.
 *
 * Constitution Principle II requires the default test suite to pass with no
 * printer attached; this is what makes that possible. Every driver test runs
 * through it, so if the suite ever needs real hardware, something has bypassed
 * the `PrinterTransport` abstraction.
 */
import type { PrinterTransport } from '../port.ts'

export interface FakeTransportOptions {
  /** Responses served in order, one per write. */
  responses?: Uint8Array[]
  /** Fail `open()` — used to exercise the unreachable path. */
  failOnOpen?: Error
  /** Fail the Nth write, counting from zero. */
  failOnWrite?: { afterWrites: number; error: Error }
}

export class FakeTransport implements PrinterTransport {
  readonly writes: Uint8Array[] = []
  openCount = 0
  closeCount = 0

  #open = false
  #handlers = new Set<(chunk: Uint8Array) => void>()
  #responses: Uint8Array[]
  #options: FakeTransportOptions

  constructor(options: FakeTransportOptions = {}) {
    this.#options = options
    this.#responses = [...(options.responses ?? [])]
  }

  get isOpen(): boolean {
    return this.#open
  }

  async open(): Promise<void> {
    this.openCount += 1
    if (this.#options.failOnOpen) {
      throw this.#options.failOnOpen
    }
    this.#open = true
  }

  async close(): Promise<void> {
    this.closeCount += 1
    this.#open = false
    this.#handlers.clear()
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.#open) {
      throw new Error('transport is not open')
    }
    const failure = this.#options.failOnWrite
    if (failure && this.writes.length === failure.afterWrites) {
      throw failure.error
    }
    this.writes.push(new Uint8Array(data))

    const response = this.#responses.shift()
    if (response !== undefined) {
      this.emit(response)
    }
  }

  onData(handler: (chunk: Uint8Array) => void): () => void {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  /** Push an inbound frame, as if the device had spoken unprompted. */
  emit(chunk: Uint8Array): void {
    for (const handler of this.#handlers) {
      handler(chunk)
    }
  }

  /** Everything written so far, concatenated — for golden-sample assertions. */
  writtenBytes(): Uint8Array {
    const total = this.writes.reduce((sum, w) => sum + w.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const write of this.writes) {
      out.set(write, offset)
      offset += write.length
    }
    return out
  }

  writtenHex(): string {
    return Array.from(this.writtenBytes(), (b) => b.toString(16).padStart(2, '0')).join('')
  }
}
