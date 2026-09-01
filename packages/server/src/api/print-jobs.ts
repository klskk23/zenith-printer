/**
 * Print job endpoints (User Story 1 scope).
 *
 * Submission returns immediately with a job id (FR-012) — nobody should have to
 * hold a browser tab open while a hundred labels come out. In this slice the
 * queue has capacity one and runs inline; User Story 2 replaces the runner
 * without changing this contract.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { printJobInputSchema } from '../domain/print-job.ts'
import { JobRepo } from '../db/repositories/job-repo.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { TemplateRepo } from '../db/repositories/template-repo.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { SequenceAllocator } from '../domain/sequence-allocator.ts'
import { checkLabel } from '../domain/overflow.ts'
import { ApiError, HttpStatus } from './errors.ts'
import { acceptJob } from './job-acceptance.ts'
import { refreshFromAddress, withRefreshLock } from './data-sources.ts'
import { DataSourceRepo } from '../db/repositories/data-source-repo.ts'
import {
  assertFitsPrinter,
  selectRows,
  designValues,
  resolveContent,
  reprintSnapshot,
} from './job-submission.ts'

const idParams = z.object({ id: z.string().min(1) })
const listQuery = z.object({
  printerId: z.string().min(1).optional(),
  status: z.enum(['queued', 'printing', 'completed', 'failed', 'cancelled']).optional(),
  /**
   * Only jobs that are over — what the history page shows.
   *
   * `stringbool` rather than `coerce.boolean`, which would read the string
   * "false" as true, every query string being strings.
   */
  finished: z.stringbool().optional(),
  /**
   * At most this many, taken from the most recent end.
   *
   * Absent means all of them, and that has to stay the default: the queue page
   * reads this same endpoint, and a truncating default would hide queued work
   * from the one screen that exists to show it.
   */
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

/**
 * How much history to keep. Zero empties it.
 *
 * No plan-then-confirm round trip like the image sweep has: the caller already
 * knows the total from the list endpoint, so it can say "this deletes 372"
 * before asking. The confirmation itself is not optional — deleting history is
 * irreversible, and the constitution requires an explicit yes for that (III.0).
 */
const prunePayload = z.object({
  keep: z.number().int().min(0).max(10_000),
})

export async function registerPrintJobRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const jobs = (): JobRepo => new JobRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const ctx = () => ({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printers = (): PrinterRepo => new PrinterRepo(ctx())
  const templates = (): TemplateRepo => new TemplateRepo(ctx())
  const profiles = (): ProfileRepo => new ProfileRepo(ctx())

  /**
   * Report what would be clipped, without submitting anything.
   *
   * Always 200: this is a question, not a validation failure. Overflow never
   * blocks a batch (FR-067), so there is no failure code for it — the point is
   * to put the facts in front of the operator before they decide, and to list
   * *every* affected row so one pass is enough.
   */
  typed.post(
    '/api/print-jobs/preflight',
    { schema: { body: printJobInputSchema } },
    async (request) => {
      const input = request.body
      const printer = printers().find(input.printerId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: input.printerId })
      }
      const template =
        input.templateId === undefined ? null : (templates().find(input.templateId) ?? null)
      const profile = input.profileId === undefined ? null : (profiles().find(input.profileId) ?? null)
      const content = resolveContent(template, input.ir, profile, printer.capabilities)

      const values = designValues(template)
      return { warnings: checkLabel(content.ir, values, 0) }
    },
  )

  typed.post(
    '/api/print-jobs',
    {
      schema: {
        body: printJobInputSchema,
        headers: z.object({ 'idempotency-key': z.string().min(1).optional() }).loose(),
      },
    },
    async (request, reply) => {
      const input = request.body
      const printer = printers().find(input.printerId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: input.printerId })
      }
      if (printer.capabilities === null) {
        throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
      }

      const template =
        input.templateId === undefined ? null : (templates().find(input.templateId) ?? null)
      if (input.templateId !== undefined && template === null) {
        throw ApiError.notFound({ templateId: input.templateId })
      }
      // No printer-kind gate any more. Both drivers are handed a rasterised
      // bitmap, so a design has no kind of its own to clash with; what decides
      // whether it can be printed is whether it fits the head, checked below
      // against this printer rather than against whatever it was drawn on.

      const profile = input.profileId === undefined ? null : (profiles().find(input.profileId) ?? null)
      if (input.profileId !== undefined && profile === null) {
        throw ApiError.notFound({ profileId: input.profileId })
      }

      const content = resolveContent(template, input.ir, profile, printer.capabilities)

      /**
       * Fetch before printing, where the source asks for it.
       *
       * Off by default, and only allowed on a source with a key column — see
       * `HTTP_SOURCE_KEY_COLUMN_REQUIRED`. Without one, refreshing here would
       * move the rows out from under a selection somebody has already made,
       * and would do it in the moment between choosing and printing.
       *
       * A producer that cannot be reached is a **409**, not a fall back to the
       * rows already stored. Printing yesterday's data because today's could
       * not be fetched is precisely the outcome asking for this was meant to
       * avoid, and a timing problem is worth retrying.
       */
      const boundSource =
        template?.dataSourceId === null || template?.dataSourceId === undefined
          ? undefined
          : new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }).find(
              template.dataSourceId,
            )
      if (boundSource?.refreshBeforePrint === true && boundSource.sourceKind === 'http') {
        await withRefreshLock(boundSource.id, async () => {
          const outcome = await refreshFromAddress(app, new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }), boundSource, false)
          if (outcome.outcome !== 'applied') {
            // A column change wants a person to look at it, not a job to go
            // ahead on whichever half of the table it happens to have.
            throw ApiError.conflict('DATA_SOURCE_REFRESH_IN_PROGRESS', {
              dataSourceId: boundSource.id,
              outcome: outcome.outcome,
            })
          }
        })
      }

      // The rows this job will print, copied out of the data source now. From
      // here on the job is self-contained: editing the table afterwards cannot
      // change what history says, or what a reprint produces (FR-039).
      const selected = selectRows({
        db: app.ctx.db,
        clock: app.ctx.clock,
        ids: app.ctx.ids,
        template,
        selection: input.rowSelection,
        copies: input.copies,
      })

      // Everything from here to the queue kick is shared with the preset path,
      // so the two cannot drift apart on the order of the checks or on when
      // the serials are claimed. See api/job-acceptance.ts.
      const accepted = acceptJob(
        { db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids, queue: app.ctx.queue, log: request.log },
        {
          printer,
          template,
          profile,
          content,
          selected,
          copies: input.copies,
          idempotencyKey:
            request.headers['idempotency-key'] === undefined
              ? undefined
              : String(request.headers['idempotency-key']),
        },
      )

      // 202: accepted for printing, not finished printing (FR-012).
      return reply.status(HttpStatus.Accepted).send(accepted)
    },
  )

  typed.get('/api/print-jobs', { schema: { querystring: listQuery } }, async (request) => {
    const store = jobs()
    return {
      jobs: store.list(request.query),
      // Ignores `limit`, deliberately: it is what lets the page offer "show
      // all 372" while holding ten.
      total: store.count({ ...request.query, limit: undefined }),
    }
  })

  typed.get('/api/print-jobs/:id', { schema: { params: idParams } }, async (request) => {
    const job = jobs().find(request.params.id)
    if (job === undefined) {
      throw ApiError.notFound({ jobId: request.params.id })
    }
    return job
  })

  /**
   * Reprint a failed job.
   *
   * The copy count is supplied by the caller rather than taken from the
   * original, because the reason to reprint is usually a shortfall: a job that
   * failed after 60 of 100 needs 40, and one interrupted by a restart needs
   * however many the operator counts on the bench. Defaulting to the original
   * count would reprint the ones already on the roll.
   *
   * Content comes from the job's snapshot, not from the template: the design
   * may have been edited or deleted since, and a reprint has to match what came
   * out the first time (FR-050).
   */
  typed.post(
    '/api/print-jobs/:id/reprint',
    {
      schema: {
        params: idParams,
        body: z.object({
          copies: z.number().int().min(1).max(100),
          /**
           * Where to send it, and how dark. Both default to what the original
           * used, which is what a plain "print that again" means; naming
           * either is the reason somebody opened the dialog — the first
           * machine jammed, or the labels came out too light.
           */
          printerId: z.string().min(1).optional(),
          profileId: z.string().min(1).optional(),
        }),
        headers: z.object({ 'idempotency-key': z.string().min(1).optional() }).loose(),
      },
    },
    async (request, reply) => {
      const store = jobs()
      const original = store.find(request.params.id)
      if (original === undefined) {
        throw ApiError.notFound({ jobId: request.params.id })
      }
      // A named printer replaces the original — including when the original was
      // deleted, which used to make the job unreprintable for good.
      const wantedPrinterId = request.body.printerId ?? original.printerId
      if (wantedPrinterId === null) {
        throw ApiError.unprocessable('VALIDATION_FAILED', { jobId: original.id })
      }
      const printer = printers().find(wantedPrinterId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: wantedPrinterId })
      }
      if (printer.capabilities === null) {
        // Nothing downstream knows the head width or the dpi until it has been
        // probed, so there is no size to print at.
        throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
      }
      const profileId = request.body.profileId ?? original.profileId
      const profile = profileId === null || profileId === undefined ? null : profiles().find(profileId)
      if (profileId !== null && profileId !== undefined && profile === undefined) {
        throw ApiError.notFound({ profileId })
      }
      if (profile !== undefined && profile !== null && profile.printerId !== printer.id) {
        // Density and label type mean something only against a particular head.
        throw ApiError.unprocessable('PROFILE_PRINTER_MISMATCH', {
          profileId: profile.id,
          printerId: printer.id,
        })
      }
      if (printer.queueState === 'paused') {
        // The failure that produced this job paused the queue. Resuming is a
        // deliberate act — it says the fault has been dealt with — so it is not
        // done implicitly here.
        throw ApiError.conflict('QUEUE_PAUSED', { printerId: printer.id })
      }

      // Kind is deliberately NOT checked. Both drivers are handed a bitmap, so
      // a design has no kind of its own to clash with; that gate was removed
      // when templates were decoupled from printers, and the FR-032 amendment
      // records why. What decides is whether the label fits the head — the same
      // check a normal submission makes, and one the reprint path was missing.
      const snapshot = reprintSnapshot(original.snapshot, printer, profile ?? null)
      assertFitsPrinter(snapshot.ir, printer)

      const idempotencyKey = request.headers['idempotency-key'] ?? randomUUID()
      const { job, created } = store.createOrGet({
        idempotencyKey: String(idempotencyKey),
        printerId: printer.id,
        templateId: original.templateId,
        profileId: profile?.id ?? null,
        requestedCopies: request.body.copies,
        // Sequence numbers are deliberately not carried over: a reprint of a
        // spoiled batch reuses the original span, which is recorded on the
        // snapshot it reprints from.
        snapshot,
      })

      if (created) {
        void app.ctx.queue?.drain(printer.id).catch((err: unknown) => {
          request.log.error({ err, printerId: printer.id }, 'queue runner failed')
        })
      }

      return reply.status(HttpStatus.Accepted).send({
        jobId: job.id,
        status: job.status,
        requestedCopies: job.requestedCopies,
        reprintOf: original.id,
      })
    },
  )

  /**
   * Throw away all but the most recent `keep` finished jobs.
   *
   * The first thing in the product that deletes a print_jobs row. What makes
   * that safe is migration 15: the sequence claims recorded against those jobs
   * stay behind, so the numbering cannot roll back onto serials that are
   * already on labels.
   */
  typed.post('/api/print-jobs/prune', { schema: { body: prunePayload } }, async (request) => {
    const result = jobs().pruneFinished(request.body.keep)

    // Principle V: a maintenance action that deletes records says so where a
    // person can find it months later.
    app.log.info(
      { event: 'print_history_pruned', deleted: result.deleted, kept: result.kept, keep: request.body.keep },
      'pruned print history',
    )
    return result
  })

  typed.delete('/api/print-jobs/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = jobs()
    const job = store.find(request.params.id)
    if (job === undefined) {
      throw ApiError.notFound({ jobId: request.params.id })
    }

    // FR-019: labels already coming out cannot be recalled, and stopping
    // mid-run would leave the printed count unverifiable.
    if (job.status === 'printing') {
      throw ApiError.conflict('JOB_ALREADY_PRINTING', { jobId: job.id })
    }
    if (job.status !== 'queued') {
      throw ApiError.conflict('JOB_ALREADY_PRINTING', { jobId: job.id, status: job.status })
    }

    store.markCancelled(job.id)
    // The job printed nothing, so holding its numbers would skip them for no
    // reason at all (FR-019).
    new SequenceAllocator(app.ctx.db, app.ctx.clock, app.ctx.ids).release(job.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
