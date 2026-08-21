/**
 * Injectable time and identity sources.
 *
 * Constitution Principle II: "tests MUST be deterministic; real clocks and
 * random sources are forbidden, and both MUST be injectable." Job timestamps,
 * idempotency keys and sequence bookkeeping all read from here, so a test can
 * pin them and assert exact values.
 */
export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(): string
}

export const systemClock: Clock = {
  now: () => new Date(),
}

export const uuidGenerator: IdGenerator = {
  next: () => crypto.randomUUID(),
}

/** Clock that starts at a fixed instant and only advances when told to. */
export class FixedClock implements Clock {
  #current: Date

  constructor(start: Date | string) {
    this.#current = new Date(start)
  }

  now(): Date {
    return new Date(this.#current)
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms)
  }

  set(instant: Date | string): void {
    this.#current = new Date(instant)
  }
}

/** Counter-based ids, so assertions can name them. */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0
  readonly #prefix: string

  constructor(prefix = 'id') {
    this.#prefix = prefix
  }

  next(): string {
    this.#counter += 1
    return `${this.#prefix}-${String(this.#counter).padStart(4, '0')}`
  }
}
