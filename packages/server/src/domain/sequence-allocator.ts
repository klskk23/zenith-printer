/**
 * Sequence range allocation.
 *
 * The whole design turns on one asymmetry: **a skipped serial is a gap in a
 * ledger, a repeated serial is two boxes nobody can tell apart.** So every
 * decision here errs towards skipping.
 *
 * That is why ranges are claimed when a job is *queued*, not when it starts
 * printing (FR-049). Two jobs submitted a second apart would otherwise both
 * read the same "highest used so far" and both start from it. Claiming at
 * enqueue time, inside one transaction, makes the database's write
 * serialisation do the mutual exclusion for us.
 *
 * Cancelling releases the claim, because a job that never printed consumed
 * nothing — holding the numbers would burn a gap for no reason (FR-019).
 */
import type { Database } from '../db/index.ts'
import {
  SequenceOverflowError,
  rangeFor,
  type SequenceRange,
  type VariableField,
} from './variable-field.ts'

export interface AllocationRequest {
  jobId: string
  templateId: string
  fields: VariableField[]
  copies: number
  /** Per-field starting values chosen by the user, overriding the suggestion. */
  overrides?: Record<string, number>
}

export interface SuggestedStart {
  fieldName: string
  suggestedStart: number
  seqDigits: number
  seqStep: number
  maxRepresentable: number
}

export class SequenceAllocator {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /**
   * Highest value this field has ever issued, across every job that still has
   * a claim. Failed and completed jobs count: their numbers went onto labels.
   */
  #highestConsumed(templateId: string, fieldName: string): number | null {
    const rows = this.#db
      .prepare(
        `SELECT seq_ranges FROM print_jobs
         WHERE template_id = ? AND status IN ('queued','printing','completed','failed')`,
      )
      .all(templateId)

    let highest: number | null = null
    for (const row of rows) {
      const ranges = JSON.parse(String(row.seq_ranges)) as Record<string, SequenceRange>
      const range = ranges[fieldName]
      if (range !== undefined && (highest === null || range.end > highest)) {
        highest = range.end
      }
    }
    return highest
  }

  /** Starting value to offer the user, and the limits around it (FR-048). */
  suggest(templateId: string, field: VariableField): SuggestedStart {
    const digits = field.seqDigits ?? 1
    const step = field.seqStep ?? 1
    const highest = this.#highestConsumed(templateId, field.name)

    return {
      fieldName: field.name,
      suggestedStart: highest === null ? (field.seqStart ?? 1) : highest + step,
      seqDigits: digits,
      seqStep: step,
      maxRepresentable: 10 ** digits - 1,
    }
  }

  /**
   * Claim a span for every sequence field on a job.
   *
   * Runs inside one transaction so concurrent submissions cannot both read the
   * same high-water mark. Overflow aborts the whole allocation rather than
   * leaving some fields claimed.
   */
  allocate(request: AllocationRequest): Record<string, SequenceRange> {
    const sequences = request.fields.filter((field) => field.source === 'sequence')
    if (sequences.length === 0) {
      return {}
    }

    const ranges: Record<string, SequenceRange> = {}

    this.#db.exec('BEGIN IMMEDIATE')
    try {
      for (const field of sequences) {
        const override = request.overrides?.[field.name]
        const start = override ?? this.suggest(request.templateId, field).suggestedStart
        // Throws on overflow, which rolls the whole allocation back.
        ranges[field.name] = rangeFor(field, start, request.copies)
      }

      this.#db
        .prepare('UPDATE print_jobs SET seq_ranges = ? WHERE id = ?')
        .run(JSON.stringify(ranges), request.jobId)

      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }

    return ranges
  }

  /**
   * Give a claim back. Used when a queued job is cancelled: it printed
   * nothing, so holding its numbers would skip them for no reason.
   */
  release(jobId: string): void {
    this.#db.prepare("UPDATE print_jobs SET seq_ranges = '{}' WHERE id = ?").run(jobId)
  }

  /**
   * Whether a user-chosen start would reissue numbers already on labels.
   * Reported as a warning rather than a refusal — reprinting a spoiled batch
   * with its original numbers is a legitimate thing to want.
   */
  conflictsWithHistory(templateId: string, field: VariableField, start: number): boolean {
    const highest = this.#highestConsumed(templateId, field.name)
    return highest !== null && start <= highest
  }
}

export { SequenceOverflowError }
