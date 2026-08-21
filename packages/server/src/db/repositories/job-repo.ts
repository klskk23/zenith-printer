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
  SequenceRange,
} from '../../domain/print-job.ts'

type Row = Record<string, unknown>

function toJob(row: Row): PrintJob {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    printerId: row.printer_id === null ? null : String(row.printer_id),
    templateId: row.template_id === null ? null : String(row.template_id),
    profileId: row.profile_id === null ? null : String(row.profile_id),
    requestedCopies: Number(row.requested_copies),
    // NULL survives as null: it means "unknown", not "none" (FR-053).
    pagesPrinted: row.pages_printed === null ? null : Number(row.pages_printed),
    manualFieldValues: JSON.parse(String(row.manual_field_values)) as Record<string, string>,
    seqRanges: JSON.parse(String(row.seq_ranges)) as Record<string, SequenceRange>,
    status: String(row.status) as JobStatus,
    failureCode: row.failure_code === null ? null : String(row.failure_code),
    failureMessage: row.failure_message === null ? null : String(row.failure_message),
    snapshot: JSON.parse(String(row.snapshot)) as ContentSnapshot,
    createdAt: String(row.created_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

export interface CreateJobInput {
  idempotencyKey: string
  printerId: string
  templateId?: string | null
  profileId?: string | null
  requestedCopies: number
  manualFieldValues: Record<string, string>
  seqRanges: Record<string, SequenceRange>
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

  find(id: string): PrintJob | undefined {
    const row = this.#db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id)
    return row === undefined ? undefined : toJob(row as Row)
  }

  findByIdempotencyKey(key: string): PrintJob | undefined {
    const row = this.#db.prepare('SELECT * FROM print_jobs WHERE idempotency_key = ?').get(key)
    return row === undefined ? undefined : toJob(row as Row)
  }

  list(filter: { printerId?: string; status?: JobStatus } = {}): PrintJob[] {
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
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    return this.#db
      .prepare(`SELECT * FROM print_jobs ${where} ORDER BY created_at, id`)
      .all(...(params as never[]))
      .map((row) => toJob(row as Row))
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
            pages_printed, manual_field_values, seq_ranges, status, snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'queued', ?, ?)`,
      )
      .run(
        id,
        input.idempotencyKey,
        input.printerId,
        input.templateId ?? null,
        input.profileId ?? null,
        input.requestedCopies,
        JSON.stringify(input.manualFieldValues),
        JSON.stringify(input.seqRanges),
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
      .map((row) => toJob(row as Row))
  }
}
