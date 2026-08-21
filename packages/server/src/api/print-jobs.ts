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
import { checkBatch } from '../domain/overflow.ts'
import { ApiError, HttpStatus } from './errors.ts'
import {
  allocateSequences,
  assertBarcodesEncodable,
  assertFitsPrinter,
  assertManualFieldsProvided,
  assertTemplateMatchesPrinter,
  buildSnapshot,
  previewValues,
  resolveContent,
} from './job-submission.ts'

const idParams = z.object({ id: z.string().min(1) })
const listQuery = z.object({
  printerId: z.string().min(1).optional(),
  status: z.enum(['queued', 'printing', 'completed', 'failed', 'cancelled']).optional(),
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
      const content = resolveContent(template, input.ir, profile)

      const values = { ...previewValues(template), ...input.manualFieldValues }
      return { warnings: checkBatch(content.ir, () => values, input.copies) }
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
      if (template !== null) {
        assertTemplateMatchesPrinter(template, printer)
      }

      const profile = input.profileId === undefined ? null : (profiles().find(input.profileId) ?? null)
      if (input.profileId !== undefined && profile === null) {
        throw ApiError.notFound({ profileId: input.profileId })
      }

      const content = resolveContent(template, input.ir, profile)

      // Everything below runs before a single label is burned. Cheap
      // structural checks first, the sequence claim last, so a rejection never
      // leaves a claimed range stranded.
      assertFitsPrinter(content.ir, printer)
      assertManualFieldsProvided(template, input.manualFieldValues)

      const values = { ...previewValues(template), ...input.manualFieldValues }
      assertBarcodesEncodable(content.ir, values)

      // Overflow is recorded, not enforced. Content past the edge is clipped,
      // and whether that is acceptable is a judgement about this label that the
      // operator is better placed to make. Holding back ninety-nine good labels
      // because one will be clipped is the worse outcome.
      const overflowWarnings = checkBatch(content.ir, () => values, input.copies)

      if (printer.queueState === 'paused') {
        throw ApiError.conflict('QUEUE_PAUSED', { printerId: printer.id })
      }

      // Without a key from the client we mint one, so a genuinely new request
      // still succeeds; a retried request supplies the same key and gets the
      // same job back rather than a second batch of labels.
      const idempotencyKey = request.headers['idempotency-key'] ?? randomUUID()

      const { job, created } = jobs().createOrGet({
        idempotencyKey: String(idempotencyKey),
        printerId: printer.id,
        templateId: template?.id ?? null,
        profileId: profile?.id ?? null,
        requestedCopies: input.copies,
        manualFieldValues: input.manualFieldValues,
        seqRanges: {},
        // Recorded on the snapshot: the design may be edited afterwards, and
        // history must show what this run actually produced.
        snapshot: { ...buildSnapshot(printer, content), overflowWarnings },
      })

      const seqRanges = created
        ? allocateSequences({
            db: app.ctx.db,
            jobId: job.id,
            template,
            copies: input.copies,
            overrides: input.sequenceOverrides,
          })
        : job.seqRanges

      // Kick the runner without waiting for it. FR-012 requires the response
      // to come back now, not when the labels stop coming out.
      if (created) {
        void app.ctx.queue?.drain(printer.id).catch((err: unknown) => {
          request.log.error({ err, printerId: printer.id }, 'queue runner failed')
        })
      }

      // 202: accepted for printing, not finished printing (FR-012).
      return reply.status(HttpStatus.Accepted).send({
        jobId: job.id,
        status: job.status,
        requestedCopies: job.requestedCopies,
        seqRanges,
        deduplicated: !created,
        // Returned so the caller can show what will be clipped; the job is
        // accepted either way.
        overflowWarnings,
      })
    },
  )

  typed.get('/api/print-jobs', { schema: { querystring: listQuery } }, async (request) => ({
    jobs: jobs().list(request.query),
  }))

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
        body: z.object({ copies: z.number().int().min(1).max(100) }),
        headers: z.object({ 'idempotency-key': z.string().min(1).optional() }).loose(),
      },
    },
    async (request, reply) => {
      const store = jobs()
      const original = store.find(request.params.id)
      if (original === undefined) {
        throw ApiError.notFound({ jobId: request.params.id })
      }
      if (original.printerId === null) {
        throw ApiError.unprocessable('VALIDATION_FAILED', { jobId: original.id })
      }
      const printer = printers().find(original.printerId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: original.printerId })
      }
      if (printer.queueState === 'paused') {
        // The failure that produced this job paused the queue. Resuming is a
        // deliberate act — it says the fault has been dealt with — so it is not
        // done implicitly here.
        throw ApiError.conflict('QUEUE_PAUSED', { printerId: printer.id })
      }

      const idempotencyKey = request.headers['idempotency-key'] ?? randomUUID()
      const { job, created } = store.createOrGet({
        idempotencyKey: String(idempotencyKey),
        printerId: printer.id,
        templateId: original.templateId,
        profileId: original.profileId,
        requestedCopies: request.body.copies,
        manualFieldValues: original.manualFieldValues,
        // Sequence numbers are deliberately not carried over: a reprint of a
        // spoiled batch reuses the original range, and that is a decision made
        // in the print form where the numbers are visible.
        seqRanges: {},
        snapshot: original.snapshot,
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
    new SequenceAllocator(app.ctx.db).release(job.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
