/**
 * Printer endpoints.
 *
 * The operator supplies address and command language; everything else is
 * probed (FR-024, FR-025).
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { printerInputSchema, queueStateSchema } from '../domain/printer.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { ApiError, HttpStatus } from './errors.ts'
import { createDriver } from '../drivers/factory.ts'
import type { Logger } from '../drivers/frame-logger.ts'

const idParams = z.object({ id: z.string().min(1) })

export async function registerPrinterRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const repo = (): PrinterRepo =>
    new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })

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
