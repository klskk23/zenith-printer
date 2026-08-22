/**
 * Sequence pool persistence, plus the derivation of the current value.
 *
 * `highestClaimed` is a `MAX` over `job_sequence_claims` narrowed by pool id.
 * It used to be narrowed by template id, which stopped working the moment a
 * pool could be shared between designs — and without the index on `pool_id`
 * every submission would scan the whole job table.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import type { SequencePool, SequencePoolInput } from '../../domain/sequence-pool.ts'

type Row = Record<string, unknown>

export class SequencePoolRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: { db: Database; clock: Clock; ids: IdGenerator }) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  #toPool(row: Row): SequencePool {
    return {
      id: String(row.id),
      name: String(row.name),
      digits: Number(row.digits),
      step: Number(row.step),
      floor: Number(row.floor),
      createdAt: String(row.created_at),
    }
  }

  list(): SequencePool[] {
    return this.#db
      .prepare('SELECT * FROM sequence_pools ORDER BY name')
      .all()
      .map((row) => this.#toPool(row as Row))
  }

  find(id: string): SequencePool | undefined {
    const row = this.#db.prepare('SELECT * FROM sequence_pools WHERE id = ?').get(id)
    return row === undefined ? undefined : this.#toPool(row as Row)
  }

  findByName(name: string): SequencePool | undefined {
    const row = this.#db.prepare('SELECT * FROM sequence_pools WHERE name = ?').get(name)
    return row === undefined ? undefined : this.#toPool(row as Row)
  }

  create(input: SequencePoolInput): SequencePool {
    const id = this.#ids.next()
    this.#db
      .prepare('INSERT INTO sequence_pools (id, name, digits, step, floor, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(id, input.name, input.digits, input.step, this.#clock.now().toISOString())
    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`sequence pool ${id} vanished immediately after insert`)
    }
    return created
  }

  update(id: string, input: SequencePoolInput): SequencePool {
    this.#db
      .prepare('UPDATE sequence_pools SET name = ?, digits = ?, step = ? WHERE id = ?')
      .run(input.name, input.digits, input.step, id)
    const updated = this.find(id)
    if (updated === undefined) {
      throw new Error(`sequence pool ${id} does not exist`)
    }
    return updated
  }

  /**
   * Reset numbering to start at `floor`.
   *
   * The claims stay — they are the evidence of what went onto labels — but they
   * stop counting towards the current value, which is what lets a reset move
   * the number *down*. That is also why this is a confirmed, irreversible
   * action: restarting at a number already printed produces duplicate serials,
   * and two boxes carrying the same serial cannot be told apart afterwards.
   */
  setFloor(id: string, floor: number): void {
    const watermark = this.#db
      .prepare('SELECT COALESCE(MAX(rowid), 0) AS high FROM job_sequence_claims WHERE pool_id = ?')
      .get(id)
    this.#db
      .prepare('UPDATE sequence_pools SET floor = ?, floor_watermark = ? WHERE id = ?')
      .run(floor, Number(watermark?.high ?? 0), id)
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM sequence_pools WHERE id = ?').run(id)
  }

  /**
   * Highest number issued since the last reset, or null if none has been.
   *
   * Narrowed by `pool_id`, which is why that column is indexed: a pool is
   * shared across designs, so this can no longer be narrowed by template and
   * would otherwise scan the whole claim table on every submission.
   */
  highestClaimed(poolId: string): number | null {
    const row = this.#db
      .prepare(
        `SELECT MAX(c.end_value) AS highest
         FROM job_sequence_claims c
         JOIN sequence_pools p ON p.id = c.pool_id
         WHERE c.pool_id = ? AND c.rowid > p.floor_watermark`,
      )
      .get(poolId)
    const value = row?.highest
    return value === null || value === undefined ? null : Number(value)
  }

  /** Designs that would lose their sequence values if this pool went away. */
  templatesUsing(poolId: string): Array<{ id: string; name: string }> {
    return this.#db
      .prepare('SELECT id, name, variables FROM templates')
      .all()
      .filter((row) => {
        try {
          const variables = JSON.parse(String((row as Row).variables ?? '[]')) as Array<Record<string, unknown>>
          return variables.some((v) => v.kind === 'sequence' && v.poolId === poolId)
        } catch {
          return false
        }
      })
      .map((row) => ({ id: String((row as Row).id), name: String((row as Row).name) }))
  }
}
