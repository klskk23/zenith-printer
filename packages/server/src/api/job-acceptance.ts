/**
 * Everything between "we know what to print" and "the job is queued".
 *
 * Extracted because there are now two ways in — a submission naming a design
 * and a selection of table rows, and a preset handed a batch of rows over HTTP
 * — and they must not be two implementations. A second copy of this would drift
 * in the direction the copier was not thinking about: the sequence claim, the
 * idempotency key, the order the checks run in. All three are the kind of thing
 * that is wrong only occasionally, and occasionally wrong about labels means a
 * duplicate serial or a second batch of stock.
 *
 * What the two callers still decide for themselves is **where the rows came
 * from**. That is the only real difference between them.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { Database } from '../db/index.ts'
import type { Clock, IdGenerator } from '../clock.ts'
import type { Printer } from '../domain/printer.ts'
import type { Template } from '../domain/template.ts'
import type { Profile } from '../domain/profile.ts'
import type { SequenceClaim } from '../domain/print-job.ts'
import { JobRepo } from '../db/repositories/job-repo.ts'
import { SequenceAllocator } from '../domain/sequence-allocator.ts'
import { checkLabel, type OverflowWarning } from '../domain/overflow.ts'
import { BarcodeEmptyValueError, assertBarcodeValuesPresent } from '../domain/barcode-refs.ts'
import { ApiError } from './errors.ts'
import {
  allocateSequences,
  assertBarcodesEncodable,
  assertFitsPrinter,
  assertNoNameCollisions,
  assertReferencesResolvable,
  buildSnapshot,
  columnPlaceholders,
  designValues,
  type ResolvedContent,
  type SelectedRows,
} from './job-submission.ts'

export interface AcceptanceContext {
  db: Database
  clock: Clock
  ids: IdGenerator
  queue?: { drain(printerId: string): Promise<void> }
  log: FastifyBaseLogger
}

export interface AcceptJobOptions {
  printer: Printer
  template: Template | null
  profile: Profile | null
  content: ResolvedContent
  /** The rows to print, however they were arrived at. */
  selected: SelectedRows
  /** Copies of each row. Also the serial count when there are no rows. */
  copies: number
  /** From the caller's header, or minted so a genuinely new request still works. */
  idempotencyKey?: string
}

export interface AcceptedJob {
  jobId: string
  status: string
  requestedCopies: number
  seqClaims: SequenceClaim[]
  deduplicated: boolean
  overflowWarnings: OverflowWarning[]
}

/**
 * Check, record, claim, queue — in that order.
 *
 * The order is the contract. Cheap structural checks first, then the ones that
 * need the device, and the sequence claim **last**, so that a rejection never
 * leaves a claimed range stranded — a gap in the serials with no labels to
 * account for it.
 */
export function acceptJob(ctx: AcceptanceContext, options: AcceptJobOptions): AcceptedJob {
  const { printer, template, profile, content, selected, copies } = options

  assertFitsPrinter(content.ir, printer)

  const values = designValues(template)

  assertNoNameCollisions(template, selected.columns)
  assertReferencesResolvable(content.ir, { ...values, ...columnPlaceholders(selected) })
  assertBarcodesEncodable(content.ir, { ...values, ...(selected.rows[0] ?? {}) })
  try {
    assertBarcodeValuesPresent(content.ir, selected.selectedRows, values)
  } catch (err) {
    if (err instanceof BarcodeEmptyValueError) {
      throw ApiError.unprocessable('BARCODE_EMPTY_VALUE', { column: err.column, ordinals: err.ordinals })
    }
    throw err
  }

  // Recorded, not enforced. Content past the edge is clipped, and whether that
  // is acceptable is a judgement about this label the operator is better placed
  // to make; holding back ninety-nine good labels for one clipped is worse.
  const overflowWarnings = checkLabel(content.ir, { ...values, ...(selected.rows[0] ?? {}) }, 0)

  if (printer.queueState === 'paused') {
    throw ApiError.conflict('QUEUE_PAUSED', { printerId: printer.id })
  }

  const idempotencyKey = options.idempotencyKey ?? randomUUID()
  const jobs = new JobRepo({ db: ctx.db, clock: ctx.clock, ids: ctx.ids })

  const { job, created } = jobs.createOrGet({
    idempotencyKey,
    printerId: printer.id,
    templateId: template?.id ?? null,
    profileId: profile?.id ?? null,
    requestedCopies: selected.labelCount,
    // On the snapshot, because the design may be edited afterwards and history
    // has to show what this run actually produced.
    snapshot: {
      ...buildSnapshot(printer, { ...content, rows: selected.rows, copiesPerRow: copies }),
      overflowWarnings,
    },
  })

  const allocator = new SequenceAllocator(ctx.db, ctx.clock, ctx.ids)
  const seqClaims = created
    ? allocateSequences({
        db: ctx.db,
        clock: ctx.clock,
        ids: ctx.ids,
        jobId: job.id,
        template,
        // Distinct serials: one per row where there are rows, otherwise one
        // per copy (FR-036).
        count: selected.rows.length > 0 ? selected.rows.length : copies,
      })
    : allocator.claimsFor(job.id)

  // Kicked without waiting: the response is due now, not when the labels stop
  // coming out (FR-012).
  if (created) {
    void ctx.queue?.drain(printer.id).catch((err: unknown) => {
      ctx.log.error({ err, printerId: printer.id }, 'queue runner failed')
    })
  }

  return {
    jobId: job.id,
    status: job.status,
    requestedCopies: job.requestedCopies,
    seqClaims,
    deduplicated: !created,
    overflowWarnings,
  }
}
