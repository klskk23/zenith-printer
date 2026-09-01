/**
 * Print presets, and printing a batch of rows through one.
 *
 * The point of the whole endpoint is that the caller supplies **rows and
 * nothing else**. Which design, which printer, which print settings and how
 * many copies are decisions made here, in front of the machine, and changing
 * any of them must not require the other side to be redeployed.
 *
 * The rows are used and thrown away. They are not stored as a data source, and
 * they do not touch what any design is bound to: a batch printed this way is a
 * batch, not a table somebody now has to maintain. What *is* kept is the job
 * snapshot, exactly as for any other job — history says what came out, and a
 * reprint reproduces the same paper.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { rowEnvelopeSchema } from '@zenith/shared'
import { PrintPresetRepo } from '../db/repositories/print-preset-repo.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { TemplateRepo } from '../db/repositories/template-repo.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { MAX_LABELS_PER_JOB } from '../domain/print-job.ts'
import { printPresetInputSchema, printPresetPatchSchema } from '../domain/print-preset.ts'
import { ApiError, HttpStatus } from './errors.ts'
import { acceptJob } from './job-acceptance.ts'
import { resolveContent, type SelectedRows } from './job-submission.ts'

const idParams = z.object({ id: z.string().min(1) })

export async function registerPrintPresetRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const ctx = () => ({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const presets = (): PrintPresetRepo => new PrintPresetRepo(ctx())
  const printers = (): PrinterRepo => new PrinterRepo(ctx())
  const templates = (): TemplateRepo => new TemplateRepo(ctx())
  const profiles = (): ProfileRepo => new ProfileRepo(ctx())

  /** Refuse a preset that names something that does not exist, at write time. */
  const assertTargetsExist = (input: {
    templateId?: string
    printerId?: string
    profileId?: string | null
  }): void => {
    if (input.templateId !== undefined && templates().find(input.templateId) === undefined) {
      throw ApiError.notFound({ templateId: input.templateId })
    }
    if (input.printerId !== undefined && printers().find(input.printerId) === undefined) {
      throw ApiError.notFound({ printerId: input.printerId })
    }
    if (
      input.profileId !== undefined &&
      input.profileId !== null &&
      profiles().find(input.profileId) === undefined
    ) {
      throw ApiError.notFound({ profileId: input.profileId })
    }
  }

  typed.get('/api/print-presets', async () => ({ printPresets: presets().list() }))

  typed.post(
    '/api/print-presets',
    { schema: { body: printPresetInputSchema } },
    async (request, reply) => {
      const repo = presets()
      if (repo.findByName(request.body.name) !== undefined) {
        throw ApiError.conflict('PRINT_PRESET_NAME_TAKEN', { name: request.body.name })
      }
      assertTargetsExist(request.body)
      return reply.status(HttpStatus.Created).send(repo.create(request.body))
    },
  )

  typed.patch(
    '/api/print-presets/:id',
    { schema: { params: idParams, body: printPresetPatchSchema } },
    async (request) => {
      const repo = presets()
      const current = repo.find(request.params.id)
      if (current === undefined) {
        throw ApiError.notFound({ printPresetId: request.params.id })
      }
      if (request.body.name !== undefined) {
        const clash = repo.findByName(request.body.name)
        if (clash !== undefined && clash.id !== current.id) {
          throw ApiError.conflict('PRINT_PRESET_NAME_TAKEN', { name: request.body.name })
        }
      }
      assertTargetsExist(request.body)
      return repo.update(current.id, request.body)!
    },
  )

  typed.delete('/api/print-presets/:id', { schema: { params: idParams } }, async (request, reply) => {
    const repo = presets()
    if (repo.find(request.params.id) === undefined) {
      throw ApiError.notFound({ printPresetId: request.params.id })
    }
    // No confirmation: a preset holds no data of its own. Deleting one loses a
    // name and four references, and every label it ever produced is still in
    // history — which is not what "irreversible" is about.
    repo.delete(request.params.id)
    return reply.status(HttpStatus.NoContent).send()
  })

  /**
   * Print a batch of rows through a preset.
   *
   * The rows resolve the design's `${references}` exactly as a bound table's
   * rows would — same evaluation, same refusals, same snapshot — so a label
   * printed this way and one printed from the table are the same label.
   *
   * The response is deliberately identical to `POST /api/print-jobs`, down to
   * the field names, and the job id it returns is polled at
   * `GET /api/print-jobs/:id`. A second status endpoint for jobs that happened
   * to arrive this way would be a second thing to keep in step.
   */
  typed.post(
    '/api/print-presets/:id/print',
    {
      schema: {
        params: idParams,
        body: rowEnvelopeSchema,
        headers: z.object({ 'idempotency-key': z.string().min(1).optional() }).loose(),
      },
    },
    async (request, reply) => {
      const preset = presets().find(request.params.id)
      if (preset === undefined) {
        throw ApiError.notFound({ printPresetId: request.params.id })
      }

      const printer = printers().find(preset.printerId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: preset.printerId })
      }
      if (printer.capabilities === null) {
        // Nothing downstream can decide what fits a head nobody has measured.
        throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
      }

      const template = templates().find(preset.templateId)
      if (template === undefined) {
        throw ApiError.notFound({ templateId: preset.templateId })
      }
      const profile = preset.profileId === null ? null : (profiles().find(preset.profileId) ?? null)

      const content = resolveContent(template, undefined, profile, printer.capabilities)

      const { columns, rows } = request.body
      const labelCount = rows.length * preset.copies
      if (labelCount > MAX_LABELS_PER_JOB) {
        // Refused, not split. Two jobs from one intention is two things to
        // reconcile, and the caller is better placed to decide how to divide
        // its own batch (FR-043).
        throw ApiError.unprocessable('BATCH_TOO_LARGE', {
          requested: labelCount,
          maxLabels: MAX_LABELS_PER_JOB,
        })
      }

      /**
       * The rows, dressed as a selection.
       *
       * `ordinal` is a position within *this batch* and nothing more — there is
       * no table for it to be a position in. It exists because the refusals
       * downstream report which row was at fault, and "row 41" is the only way
       * to say that about a batch nobody stored.
       */
      const selected: SelectedRows = {
        rows: rows as Array<Record<string, string>>,
        selectedRows: rows.map((values, index) => ({ ordinal: index + 1, values })),
        columns: [...columns],
        labelCount,
      }

      const accepted = acceptJob(
        { db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids, queue: app.ctx.queue, log: request.log },
        {
          printer,
          template,
          profile,
          content,
          selected,
          copies: preset.copies,
          idempotencyKey:
            request.headers['idempotency-key'] === undefined
              ? undefined
              : String(request.headers['idempotency-key']),
        },
      )

      return reply.status(HttpStatus.Accepted).send(accepted)
    },
  )
}
