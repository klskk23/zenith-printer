/**
 * Print job persistence.
 *
 * The unique index on `idempotency_key` is the guard that stops a browser
 * refresh from burning a second batch of labels (FR-017): a duplicate insert
 * fails, and the caller returns the original job instead of creating a new one.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import type {
  ContentSnapshot,
  JobStatus,
  PrintJob,
  SequenceClaim,
} from '../../domain/print-job.ts'

type Row = Record<string, unknown>

/**
 * Sequence claims for a set of jobs, keyed by job id.
 *
 * Loaded alongside rather than lazily: `irForLabel` needs them to substitute a
 * serial, and a job read without them would render every label with the same
 * number — visibly wrong only after the labels are out.
 */
function claimsByJob(db: Database, jobIds: readonly string[]): Map<string, SequenceClaim[]> {
  const byJob = new Map<string, SequenceClaim[]>()
  if (jobIds.length === 0) {
    return byJob
  }
  const placeholders = jobIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT job_id, pool_id, variable_name, start_value, end_value, step, digits
       FROM job_sequence_claims WHERE job_id IN (${placeholders}) ORDER BY variable_name`,
    )
    .all(...jobIds)

  for (const row of rows) {
    const jobId = String(row.job_id)
    const list = byJob.get(jobId) ?? []
    list.push({
      poolId: String(row.pool_id),
      variableName: String(row.variable_name),
      start: Number(row.start_value),
      end: Number(row.end_value),
      step: Number(row.step),
      digits: Number(row.digits),
    })
    byJob.set(jobId, list)
  }
  return byJob
}

function toJob(row: Row, claims: SequenceClaim[] = []): PrintJob {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    printerId: row.printer_id === null ? null : String(row.printer_id),
    templateId: row.template_id === null ? null : String(row.template_id),
    profileId: row.profile_id === null ? null : String(row.profile_id),
    requestedCopies: Number(row.requested_copies),
    // NULL survives as null: it means "unknown", not "none" (FR-053).
    pagesPrinted: row.pages_printed === null ? null : Number(row.pages_printed),
    seqClaims: claims,
    status: String(row.status) as JobStatus,
    failureCode: row.failure_code === null ? null : String(row.failure_code),
    failureMessage: row.failure_message === null ? null : String(row.failure_message),
    snapshot: JSON.parse(String(row.snapshot)) as ContentSnapshot,
    createdAt: String(row.created_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

/** Statuses that are over, one way or another — what history is made of. */
const FINISHED_STATUSES = ['completed', 'failed', 'cancelled'] as const

export interface JobListFilter {
  printerId?: string
  status?: JobStatus
  /** Only jobs that are over: what the history page asks for. */
  finished?: boolean
  /** At most this many, taken from the most recent end. */
  limit?: number
}

export interface CreateJobInput {
  idempotencyKey: string
  printerId: string
  templateId?: string | null
  profileId?: string | null
  requestedCopies: number
  snapshot: ContentSnapshot
}

export interface JobRepoDeps {
  db: Database
  clock: Clock
  ids: IdGenerator
}

export class JobRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: JobRepoDeps) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  #withClaims(row: Row): PrintJob {
    const id = String(row.id)
    return toJob(row, claimsByJob(this.#db, [id]).get(id) ?? [])
  }

  find(id: string): PrintJob | undefined {
    const row = this.#db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id)
    return row === undefined ? undefined : this.#withClaims(row as Row)
  }

  findByIdempotencyKey(key: string): PrintJob | undefined {
    const row = this.#db.prepare('SELECT * FROM print_jobs WHERE idempotency_key = ?').get(key)
    return row === undefined ? undefined : this.#withClaims(row as Row)
  }

  #narrow(filter: JobListFilter): { where: string; params: unknown[] } {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.printerId !== undefined) {
      clauses.push('printer_id = ?')
      params.push(filter.printerId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.finished === true) {
      clauses.push(`status IN (${FINISHED_STATUSES.map(() => '?').join(',')})`)
      params.push(...FINISHED_STATUSES)
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
  }

  /**
   * Jobs matching the filter, oldest first.
   *
   * `limit` takes the most *recent* N and hands them back in the same
   * oldest-first order as an unlimited call. Truncating from the front would
   * have returned the oldest ten, which is the opposite of what history is
   * for; flipping the order instead would have quietly reversed every caller.
   */
  list(filter: JobListFilter = {}): PrintJob[] {
    const { where, params } = this.#narrow(filter)
    if (filter.limit === undefined) {
      return this.#db
        .prepare(`SELECT * FROM print_jobs ${where} ORDER BY created_at, id`)
        .all(...(params as never[]))
        .map((row) => this.#withClaims(row as Row))
    }
    return this.#db
      .prepare(`SELECT * FROM print_jobs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...([...params, filter.limit] as never[]))
      .reverse()
      .map((row) => this.#withClaims(row as Row))
  }

  /**
   * How many match, ignoring `limit`.
   *
   * What makes "show all 372" able to say 372 when only ten were fetched.
   */
  count(filter: JobListFilter = {}): number {
    const { where, params } = this.#narrow(filter)
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS total FROM print_jobs ${where}`)
      .get(...(params as never[]))
    return Number(row?.total ?? 0)
  }

  /**
   * Delete all but the most recent `keep` finished jobs.
   *
   * Queued and printing jobs are never candidates at any `keep`: the runner
   * holds their ids, and deleting the row under a job in flight would strand
   * it and lose the count of what came out of the printer.
   *
   * The rows the sequence pools derive their numbering from are *not* deleted
   * with them — see migration 15. That is load-bearing, not incidental.
   */
  pruneFinished(keep: number): { deleted: number; kept: number } {
    const placeholders = FINISHED_STATUSES.map(() => '?').join(',')
    const result = this.#db
      .prepare(
        `DELETE FROM print_jobs
         WHERE status IN (${placeholders})
           AND id NOT IN (
             SELECT id FROM print_jobs
             WHERE status IN (${placeholders})
             ORDER BY created_at DESC, id DESC
             LIMIT ?
           )`,
      )
      .run(...([...FINISHED_STATUSES, ...FINISHED_STATUSES, keep] as never[]))
    return { deleted: Number(result.changes), kept: this.count({ finished: true }) }
  }

  /**
   * Create a job, or return the existing one for a repeated idempotency key.
   * Printing is irreversible: a retried submission must not produce a second
   * physical batch (FR-017).
   */
  createOrGet(input: CreateJobInput): { job: PrintJob; created: boolean } {
    const existing = this.findByIdempotencyKey(input.idempotencyKey)
    if (existing !== undefined) {
      return { job: existing, created: false }
    }

    const id = this.#ids.next()
    this.#db
      .prepare(
        `INSERT INTO print_jobs
           (id, idempotency_key, printer_id, template_id, profile_id, requested_copies,
            pages_printed, status, snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'queued', ?, ?)`,
      )
      .run(
        id,
        input.idempotencyKey,
        input.printerId,
        input.templateId ?? null,
        input.profileId ?? null,
        input.requestedCopies,
        JSON.stringify(input.snapshot),
        this.#clock.now().toISOString(),
      )

    const job = this.find(id)
    if (job === undefined) {
      throw new Error(`job ${id} vanished immediately after insert`)
    }
    return { job, created: true }
  }

  markStarted(id: string): void {
    this.#db
      .prepare("UPDATE print_jobs SET status = 'printing', started_at = ? WHERE id = ?")
      .run(this.#clock.now().toISOString(), id)
  }

  updateProgress(id: string, pagesPrinted: number): void {
    this.#db.prepare('UPDATE print_jobs SET pages_printed = ? WHERE id = ?').run(pagesPrinted, id)
  }

  markCompleted(id: string, pagesPrinted: number): void {
    this.#db
      .prepare("UPDATE print_jobs SET status = 'completed', pages_printed = ?, finished_at = ? WHERE id = ?")
      .run(pagesPrinted, this.#clock.now().toISOString(), id)
  }

  /** `pagesPrinted` may be null: unknown is a real, distinct outcome (FR-053). */
  markFailed(id: string, code: string, message: string, pagesPrinted: number | null): void {
    this.#db
      .prepare(
        `UPDATE print_jobs
         SET status = 'failed', failure_code = ?, failure_message = ?, pages_printed = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(code, message, pagesPrinted, this.#clock.now().toISOString(), id)
  }

  markCancelled(id: string): void {
    this.#db
      .prepare("UPDATE print_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?")
      .run(this.#clock.now().toISOString(), id)
  }

  /** Jobs left mid-print by a crash. Cleaned up at boot (FR-053). */
  findInterrupted(): PrintJob[] {
    return this.#db
      .prepare("SELECT * FROM print_jobs WHERE status = 'printing'")
      .all()
      .map((row) => this.#withClaims(row as Row))
  }
}
