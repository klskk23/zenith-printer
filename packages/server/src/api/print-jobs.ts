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
        snapshot: buildSnapshot(printer, content),
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
