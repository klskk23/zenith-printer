/**
 * Template and profile endpoints.
 *
 * The print form endpoint is the interesting one: it tells the client what to
 * ask for before a job can be submitted, including where each sequence should
 * resume (FR-048), so nobody has to remember what they printed last week.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { maxLabelWidthMm } from '../domain/printer.ts'
import { TemplateConflictError, templateInputSchema } from '../domain/template.ts'
import { profileInputSchema } from '../domain/profile.ts'
import { SequenceAllocator } from '../domain/sequence-allocator.ts'
import { TemplateRepo } from '../db/repositories/template-repo.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { ApiError, HttpStatus } from './errors.ts'

const idParams = z.object({ id: z.string().min(1) })
const printerParams = z.object({ printerId: z.string().min(1) })

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const ctx = () => ({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const templates = (): TemplateRepo => new TemplateRepo(ctx())
  const profiles = (): ProfileRepo => new ProfileRepo(ctx())
  const printers = (): PrinterRepo => new PrinterRepo(ctx())

  /** Widest canvas any printer of this kind can image (FR-005, FR-032). */
  const widthLimitFor = (kind: string): number | null => {
    const widths = printers()
      .list()
      .filter((p) => p.kind === kind && p.capabilities !== null)
      .map((p) => maxLabelWidthMm(p.capabilities!))
    return widths.length === 0 ? null : Math.max(...widths)
  }

  const assertFits = (input: { printerKind: string; widthMm: number }): void => {
    const limit = widthLimitFor(input.printerKind)
    if (limit !== null && input.widthMm > limit + 1e-6) {
      throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', {
        widthMm: input.widthMm,
        maxLabelWidthMm: Number(limit.toFixed(3)),
      })
    }
  }

  typed.get('/api/templates', async () => ({ templates: templates().list() }))

  typed.post('/api/templates', { schema: { body: templateInputSchema } }, async (request, reply) => {
    assertFits(request.body)
    return reply.status(HttpStatus.Created).send(templates().create(request.body))
  })

  typed.get('/api/templates/:id', { schema: { params: idParams } }, async (request) => {
    const template = templates().find(request.params.id)
    if (template === undefined) {
      throw ApiError.notFound({ templateId: request.params.id })
    }
    return template
  })

  typed.put(
    '/api/templates/:id',
    {
      schema: {
        params: idParams,
        body: templateInputSchema.and(z.object({ version: z.number().int().positive() })),
      },
    },
    async (request) => {
      const { version, ...input } = request.body
      assertFits(input)
      try {
        return templates().update(request.params.id, input, version)
      } catch (err) {
        if (err instanceof TemplateConflictError) {
          // Nothing is written on this path: the caller still holds their edits
          // and can reapply them after reloading.
          throw ApiError.conflict('TEMPLATE_VERSION_CONFLICT', {
            templateId: err.templateId,
            currentVersion: err.currentVersion,
          })
        }
        throw err
      }
    },
  )

  typed.delete('/api/templates/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = templates()
    if (store.find(request.params.id) === undefined) {
      throw ApiError.notFound({ templateId: request.params.id })
    }
    // Safe: job history keeps its own snapshot (FR-050, FR-051).
    store.delete(request.params.id)
    return reply.status(HttpStatus.NoContent).send()
  })

  /** What the client must collect before submitting a job (FR-038, FR-048). */
  typed.get('/api/templates/:id/print-form', { schema: { params: idParams } }, async (request) => {
    const template = templates().find(request.params.id)
    if (template === undefined) {
      throw ApiError.notFound({ templateId: request.params.id })
    }

    const allocator = new SequenceAllocator(app.ctx.db)
    return {
      templateId: template.id,
      fields: template.variableFields.map((field) =>
        field.source === 'manual'
          ? { name: field.name, label: field.label, source: 'manual', sampleValue: field.sampleValue }
          : { name: field.name, label: field.label, source: 'sequence', ...allocator.suggest(template.id, field) },
      ),
    }
  })

  typed.get('/api/printers/:printerId/profiles', { schema: { params: printerParams } }, async (request) => ({
    profiles: profiles().listFor(request.params.printerId),
  }))

  typed.post(
    '/api/printers/:printerId/profiles',
    { schema: { params: printerParams, body: profileInputSchema } },
    async (request, reply) => {
      const printer = printers().find(request.params.printerId)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: request.params.printerId })
      }
      const capabilities = printer.capabilities
      if (capabilities !== null) {
        // Density outside the probed range would be rejected by the device
        // itself, with a message far less useful than this one.
        if (request.body.density < capabilities.densityMin || request.body.density > capabilities.densityMax) {
          throw ApiError.unprocessable('VALIDATION_FAILED', {
            density: request.body.density,
            densityMin: capabilities.densityMin,
            densityMax: capabilities.densityMax,
          })
        }
      }
      return reply.status(HttpStatus.Created).send(profiles().create(printer.id, request.body))
    },
  )

  typed.patch(
    '/api/profiles/:id',
    { schema: { params: idParams, body: profileInputSchema } },
    async (request) => {
      const updated = profiles().update(request.params.id, request.body)
      if (updated === undefined) {
        throw ApiError.notFound({ profileId: request.params.id })
      }
      return updated
    },
  )

  typed.delete('/api/profiles/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = profiles()
    if (store.find(request.params.id) === undefined) {
      throw ApiError.notFound({ profileId: request.params.id })
    }
    store.delete(request.params.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
