/**
 * The API describing itself.
 *
 * Generated from the same zod schemas that validate requests and serialise
 * responses — not written alongside them. A hand-kept description is a second
 * source of truth, and the first busy week is when it stops matching.
 *
 * Only the document is served here. The console that renders it lives in the
 * frontend, where it can be a tab like any other page and can be fetched only
 * when somebody opens it.
 *
 * Worth being clear about what this does and does not expose: the service has
 * no authentication, so every route here was already reachable by anyone on the
 * network with curl. A description makes them *discoverable*, which is the
 * point — it grants nothing that was being withheld.
 */
import fastifySwagger from '@fastify/swagger'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'
import type { FastifyInstance } from 'fastify'
import { packageVersion } from '../version.ts'

/**
 * Called directly on the root instance, NOT through `app.register`.
 *
 * Fastify encapsulates plugins: registered inside a child, the swagger plugin
 * hooks `onRoute` for that child and its descendants only, and every sibling
 * route is invisible to it. The first attempt produced a document containing
 * exactly one path — its own.
 */
export function registerOpenApi(app: FastifyInstance): void {
  void app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Zenith Printer',
        description:
          'LAN label design and printing. No authentication: every endpoint here is ' +
          'reachable by anyone who can reach the port, which is why the service belongs ' +
          'on a LAN or a VPN.',
        version: packageVersion(),
      },
    },
    // Turns the zod schemas the routes already carry into JSON Schema.
    transform: jsonSchemaTransform,
  })


  // Under /api like everything else, so the frontend's dev proxy and the
  // single-process deployment both reach it without a rule of its own.
  app.get('/api/openapi.json', async () => app.swagger())
}
