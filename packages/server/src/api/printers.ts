/**
 * Printer endpoints.
 *
 * The operator supplies address and command language; everything else is
 * probed (FR-024, FR-025).
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { isOffsetWithinHead, printerInputSchema, queueStateSchema } from '../domain/printer.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { JobRepo } from '../db/repositories/job-repo.ts'
import { buildSnapshot, resolveContent } from './job-submission.ts'
import { calibrationPageIr } from '../render/calibration-page.ts'
import { randomUUID } from 'node:crypto'

import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { ApiError, HttpStatus } from './errors.ts'
import { createDriver } from '../drivers/factory.ts'
import type { Logger } from '../drivers/frame-logger.ts'

const idParams = z.object({ id: z.string().min(1) })

export async function registerPrinterRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const ctx = () => ({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const repo = (): PrinterRepo => new PrinterRepo(ctx())

  typed.get('/api/printers', async () => ({ printers: repo().list() }))

  typed.post(
    '/api/printers',
    { schema: { body: printerInputSchema } },
    async (request, reply) => {
      const printer = repo().create(request.body)
      return reply.status(HttpStatus.Created).send(printer)
    },
  )

  typed.get('/api/printers/:id', { schema: { params: idParams } }, async (request) => {
    const printer = repo().find(request.params.id)
    if (printer === undefined) {
      throw ApiError.notFound({ printerId: request.params.id })
    }
    return printer
  })

  typed.post(
    '/api/printers/:id/probe',
    { schema: { params: idParams } },
    async (request) => {
      const store = repo()
      const printer = store.find(request.params.id)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: request.params.id })
      }

      const driver = createDriver(printer, { logger: request.log as unknown as Logger })
      try {
        await driver.connect()
        const capabilities = await driver.probe()
        return store.saveCapabilities(printer.id, capabilities)
      } finally {
        // Constitution ("Resource safety"): release on every path.
        await driver.disconnect()
      }
    },
  )

  /**
   * Position correction.
   *
   * Rejected rather than clamped when it exceeds the head: a silently clamped
   * offset looks like the correction was accepted and simply did nothing,
   * which sends the operator back to measuring the paper again.
   */
  /**
   * Change how a printer is reached.
   *
   * An address is not permanent: a networked printer is given a new IP, a USB
   * device node is renumbered when something else is plugged in, a serial port
   * moves. Without this the only way to correct one was to delete the printer
   * and add it again — which throws away its profiles, its position
   * correction and the link from every job it has ever run.
   */
  typed.patch(
    '/api/printers/:id',
    {
      schema: {
        params: idParams,
        body: z
          .object({
            name: z.string().min(1).max(80).optional(),
            address: z.string().min(1).optional(),
            printTaskName: z.string().min(1).optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: 'at least one field must be given',
          }),
      },
    },
    async (request) => {
      const store = repo()
      const current = store.find(request.params.id)
      if (current === undefined) {
        throw ApiError.notFound({ printerId: request.params.id })
      }

      // Mid-flight jobs hold this printer's address; moving it under them would
      // send the rest of a batch somewhere else, or nowhere.
      if (request.body.address !== undefined && request.body.address !== current.address) {
        const queued = store.queuedJobCount(request.params.id)
        if (queued > 0) {
          throw ApiError.conflict('PRINTER_HAS_QUEUED_JOBS', {
            printerId: request.params.id,
            queuedJobs: queued,
          })
        }
      }

      return store.updateConnection(request.params.id, request.body)
    },
  )

  typed.patch(
    '/api/printers/:id/offset',
    {
      schema: {
        params: idParams,
        body: z.object({
          offsetXDots: z.number().int(),
          offsetYDots: z.number().int(),
        }),
      },
    },
    async (request) => {
      const store = repo()
      const printer = store.find(request.params.id)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: request.params.id })
      }
      if (!isOffsetWithinHead(request.body, printer.capabilities)) {
        throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', {
          offsetXDots: request.body.offsetXDots,
          offsetYDots: request.body.offsetYDots,
          printheadPixels: printer.capabilities?.printheadPixels ?? null,
        })
      }
      return store.setOffset(request.params.id, request.body.offsetXDots, request.body.offsetYDots)
    },
  )

  typed.patch(
    '/api/printers/:id/queue',
    { schema: { params: idParams, body: z.object({ queueState: queueStateSchema }) } },
    async (request) => {
      const store = repo()
      if (store.find(request.params.id) === undefined) {
        throw ApiError.notFound({ printerId: request.params.id })
      }
      const printer = store.setQueueState(request.params.id, request.body.queueState, null)

      // Resuming should start work immediately rather than waiting for the
      // next submission to wake the runner.
      if (request.body.queueState === 'running') {
        void app.ctx.queue?.drain(request.params.id).catch((err: unknown) => {
          request.log.error({ err, printerId: request.params.id }, 'queue runner failed')
        })
      }

      return printer
    },
  )

  /**
   * Print a calibration label.
   *
   * Consumes stock and cannot be undone, so it refuses without an explicit
   * confirmation — the same rule the print dialog follows, and for the same
   * reason: an action that quietly burns labels will eventually burn them by
   * accident.
   *
   * It goes through the ordinary job queue rather than printing inline, so it
   * queues behind existing work instead of interleaving with it, and so the
   * offset under correction is applied to it like any other label.
   */
  typed.post(
    '/api/printers/:id/calibration-page',
    {
      schema: {
        params: idParams,
        body: z.object({
          profileId: z.string().min(1).optional(),
          confirmed: z.boolean().default(false),
        }),
      },
    },
    async (request, reply) => {
      const store = repo()
      const printer = store.find(request.params.id)
      if (printer === undefined) {
        throw ApiError.notFound({ printerId: request.params.id })
      }
      if (!request.body.confirmed) {
        throw ApiError.badRequest('CONFIRMATION_REQUIRED', { printerId: printer.id })
      }
      const capabilities = printer.capabilities
      if (capabilities === null) {
        throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
      }

      const profiles = new ProfileRepo(ctx())
      const profile =
        request.body.profileId === undefined
          ? (profiles.listFor(printer.id).find((p) => p.isDefault) ?? null)
          : (profiles.find(request.body.profileId) ?? null)

      /*
       * The page is measured against the edges of the paper, so it has to be
       * the size of the paper.
       *
       * Refused rather than guessed. This used to fall back to the printhead's
       * full width, which on a 50 mm roll means printing a 104 mm page: a
       * wasted label, and one that cannot be measured because most of it is
       * not there. Being told to pick the stock costs a click; guessing costs
       * a label and produces nothing.
       */
      if (profile === null) {
        throw ApiError.unprocessable('CALIBRATION_STOCK_UNKNOWN', {
          printerId: printer.id,
          profileCount: profiles.listFor(printer.id).length,
        })
      }

      const ir = calibrationPageIr({
        widthMm: profile.labelWidthMm,
        heightMm: profile.labelHeightMm,
        dpi: capabilities.dpi,
      })

      if (printer.queueState === 'paused') {
        throw ApiError.conflict('QUEUE_PAUSED', { printerId: printer.id })
      }

      // Submitted as an ordinary job rather than printed inline: it queues
      // behind existing work instead of interleaving with it, and the offset
      // being corrected is applied to it exactly as to any other label — which
      // is what makes "print it again to check" mean anything.
      const content = resolveContent(null, ir, profile)
      const { job } = new JobRepo(ctx()).createOrGet({
        idempotencyKey: randomUUID(),
        printerId: printer.id,
        templateId: null,
        profileId: profile?.id ?? null,
        requestedCopies: 1,
        snapshot: buildSnapshot(printer, { ...content, rows: [], copiesPerRow: 1 }),
      })

      void app.ctx.queue?.drain(printer.id).catch((err: unknown) => {
        request.log.error({ err, printerId: printer.id }, 'queue runner failed')
      })

      return reply.status(HttpStatus.Accepted).send({
        printerId: printer.id,
        jobId: job.id,
        status: job.status,
      })
    },
  )

  typed.delete('/api/printers/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = repo()
    const printer = store.find(request.params.id)
    if (printer === undefined) {
      throw ApiError.notFound({ printerId: request.params.id })
    }

    // FR-052: deleting the device would orphan work that has not printed yet.
    const queued = store.queuedJobCount(printer.id)
    if (queued > 0) {
      throw ApiError.conflict('PRINTER_HAS_QUEUED_JOBS', { queuedJobs: queued })
    }

    store.delete(printer.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
