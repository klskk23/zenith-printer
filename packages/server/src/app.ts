/**
 * Fastify application.
 *
 * Single process: the same server that exposes the API also serves the built
 * frontend, so deployment is one systemd unit.
 *
 * zod validates every external input before it reaches business logic
 * (constitution: "Boundary validation"), and every failure leaves through one
 * error handler so the response shape is identical everywhere (FR-033).
 */
import Fastify, { type FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { negotiateLocale } from './i18n/negotiate.ts'
import { describeAppError } from './i18n/error-map.ts'
import { HttpStatus, toErrorResponse } from './api/errors.ts'
import { systemClock, uuidGenerator, type Clock, type IdGenerator } from './clock.ts'
import type { Database } from './db/index.ts'
import { registerPrinterRoutes } from './api/printers.ts'
import { registerPrintJobRoutes } from './api/print-jobs.ts'
import { registerPreviewRoutes } from './api/preview.ts'
import { registerImageRoutes } from './api/images.ts'
import { registerTemplateIoRoutes } from './api/template-io.ts'
import { registerTemplateRoutes } from './api/templates.ts'
import { registerSequencePoolRoutes } from './api/sequence-pools.ts'
import { registerDataSourceRoutes } from './api/data-sources.ts'
import { createQueue } from './queue/manager.ts'
import type { PrintQueue } from './queue/print-queue.ts'

export interface AppDependencies {
  db: Database
  /** Directory for uploaded images. */
  imageStorageDir?: string
  /** Set false in tests that exercise routes without running jobs. */
  enableQueue?: boolean
  clock?: Clock
  idGenerator?: IdGenerator
  logLevel?: 'error' | 'warn' | 'info' | 'debug'
}

export interface AppContext {
  db: Database
  clock: Clock
  ids: IdGenerator
  /** Undefined when the caller opted out, e.g. focused route tests. */
  queue?: PrintQueue
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
    /** Set by registerStatic when a frontend build is present. */
    spaFallback: (() => string) | undefined
  }
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    // Structured, level-controlled logging (Principle V).
    logger: { level: deps.logLevel ?? 'info' },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.decorate('ctx', {
    db: deps.db,
    clock: deps.clock ?? systemClock,
    ids: deps.idGenerator ?? uuidGenerator,
  })

  app.setErrorHandler((error, request, reply) => {
    // Schema failures are a client problem; report them as such rather than
    // letting Fastify's default 500 swallow the reason.
    // The first point that knows who is asking, and therefore the only place
    // the prose can be chosen (FR-073).
    const locale = negotiateLocale(request.headers['accept-language'])

    if (hasZodFastifySchemaValidationErrors(error)) {
      const body = describeAppError('VALIDATION_FAILED', locale)
      request.log.info({ issues: error.validation }, 'request failed validation')
      return reply.status(HttpStatus.BadRequest).send({
        ...body,
        details: { issues: error.validation },
      })
    }

    const { status, body } = toErrorResponse(error, locale)

    // An unreachable printer is an expected daily condition, not a defect:
    // B3S_P powers itself off after an hour idle and cannot be woken over USB.
    // Logging a stack trace for it would bury the failures that do matter.
    if (body.code === 'PRINTER_UNREACHABLE') {
      request.log.warn({ code: body.code, details: body.details }, 'printer unreachable')
    } else if (status >= 500) {
      request.log.error({ err: error, code: body.code }, 'request failed')
    } else {
      request.log.info({ code: body.code }, 'request rejected')
    }

    return reply.status(status).send(body)
  })

  // Fastify allows exactly one not-found handler per prefix, so the SPA
  // fallback is registered here rather than by the static plugin. API misses
  // stay JSON; anything else is a client-side route.
  app.decorate('spaFallback', undefined as (() => string) | undefined)

  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api/') && app.spaFallback !== undefined) {
      return reply.type('text/html').send(app.spaFallback())
    }
    return reply.status(HttpStatus.NotFound).send(describeAppError('NOT_FOUND'))
  })

  if (deps.enableQueue !== false) {
    const queue = createQueue(app)
    app.ctx.queue = queue

    // FR-053: jobs the last run left mid-print are resolved before anything
    // new starts, so a restart never leaves a job stuck in 'printing'.
    const recovered = queue.recoverInterruptedJobs()
    if (recovered.length > 0) {
      app.log.warn(
        { count: recovered.length },
        'jobs were interrupted by a restart; their printed counts are unknown',
      )
    }
  }

  app.get('/api/health', async () => ({ status: 'ok' }))

  // Routes are registered eagerly; Fastify resolves the returned promise
  // through `app.after()` when the caller awaits `ready()`.
  void app.register(registerPrinterRoutes)
  void app.register(registerPrintJobRoutes)
  void app.register(registerTemplateRoutes)
  void app.register(registerSequencePoolRoutes)
  void app.register(registerDataSourceRoutes)
  void app.register(registerPreviewRoutes)
  void app.register((instance) =>
    registerImageRoutes(instance, { storageDir: deps.imageStorageDir ?? 'uploads' }),
  )
  void app.register((instance) =>
    registerTemplateIoRoutes(instance, { storageDir: deps.imageStorageDir ?? 'uploads' }),
  )

  return app
}
