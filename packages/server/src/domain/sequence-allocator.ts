/**
 * Sequence claim allocation.
 *
 * The whole design turns on one asymmetry: **a skipped serial is a gap in a
 * ledger, a repeated serial is two boxes nobody can tell apart.** Every
 * decision here errs towards skipping.
 *
 * That is why spans are claimed when a job is *queued*, not when it starts
 * printing (FR-049). Two jobs submitted a second apart would otherwise both
 * read the same "highest used so far" and both start from it. Claiming at
 * enqueue time, inside one transaction, makes the database's write
 * serialisation do the mutual exclusion.
 *
 * Cancelling releases the claim, because a job that never printed consumed
 * nothing — holding the numbers would burn a gap for no reason (FR-019).
 */
import type { Database } from '../db/index.ts'
import { SequencePoolRepo } from '../db/repositories/sequence-pool-repo.ts'
import {
  SequenceOverflowError,
  currentValue,
  spanFor,
  type SequencePool,
} from './sequence-pool.ts'
import type { SequenceClaim } from './print-job.ts'
import type { Clock, IdGenerator } from '../clock.ts'

/** A design's sequence variable: the pool it draws from, under a local name. */
export interface SequenceBinding {
  variableName: string
  poolId: string
}

export interface AllocationRequest {
  jobId: string
  bindings: readonly SequenceBinding[]
  /** How many *distinct* serials this job needs — rows, not labels. */
  count: number
}

export class UnknownSequencePoolError extends Error {
  readonly poolId: string

  constructor(poolId: string) {
    super(`sequence pool ${poolId} does not exist`)
    this.name = 'UnknownSequencePoolError'
    this.poolId = poolId
  }
}

export class SequenceAllocator {
  readonly #db: Database
  readonly #pools: SequencePoolRepo

  constructor(db: Database, clock: Clock, ids: IdGenerator) {
    this.#db = db
    this.#pools = new SequencePoolRepo({ db, clock, ids })
  }

  /** The next number this pool will issue, and the limits around it. */
  suggest(pool: SequencePool): { start: number; maxRepresentable: number } {
    const highest = this.#pools.highestClaimed(pool.id)
    return {
      start: highest === null ? Math.max(pool.floor, 1) : currentValue(pool.floor, highest) + pool.step,
      maxRepresentable: 10 ** pool.digits - 1,
    }
  }

  /**
   * Claim a span from every pool this job draws from.
   *
   * One transaction, so concurrent submissions cannot both read the same
   * high-water mark. Overflow aborts the whole allocation rather than leaving
   * some pools claimed and others not.
   */
  allocate(request: AllocationRequest): SequenceClaim[] {
    if (request.bindings.length === 0) {
      return []
    }

    const claims: SequenceClaim[] = []
    const insert = this.#db.prepare(
      `INSERT INTO job_sequence_claims (job_id, pool_id, variable_name, start_value, end_value, step, digits)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )

    this.#db.exec('BEGIN IMMEDIATE')
    try {
      for (const binding of request.bindings) {
        const pool = this.#pools.find(binding.poolId)
        if (pool === undefined) {
          throw new UnknownSequencePoolError(binding.poolId)
        }
        // Throws on overflow, which rolls the whole allocation back.
        const span = spanFor(pool, this.suggest(pool).start, request.count)
        claims.push({ poolId: pool.id, variableName: binding.variableName, ...span })
        insert.run(request.jobId, pool.id, binding.variableName, span.start, span.end, span.step, span.digits)
      }
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }

    return claims
  }

  /**
   * Give a claim back. Used when a queued job is cancelled: it printed
   * nothing, so holding its numbers would skip them for no reason.
   */
  release(jobId: string): void {
    this.#db.prepare('DELETE FROM job_sequence_claims WHERE job_id = ?').run(jobId)
  }

  claimsFor(jobId: string): SequenceClaim[] {
    return this.#db
      .prepare('SELECT * FROM job_sequence_claims WHERE job_id = ? ORDER BY variable_name')
      .all(jobId)
      .map((row) => ({
        poolId: String(row.pool_id),
        variableName: String(row.variable_name),
        start: Number(row.start_value),
        end: Number(row.end_value),
        step: Number(row.step),
        digits: Number(row.digits),
      }))
  }
}

export { SequenceOverflowError }
