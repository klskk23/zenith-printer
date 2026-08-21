/**
 * Serve the built frontend from the same process as the API.
 *
 * Single-process deployment (plan.md): one systemd unit, no reverse proxy,
 * no separate frontend host. Unknown non-API paths fall through to index.html
 * so client-side routing works on a hard refresh.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export interface StaticOptions {
  /** Directory holding the Vite build output. */
  root: string
}

export async function registerStatic(app: FastifyInstance, options: StaticOptions): Promise<void> {
  if (!existsSync(options.root)) {
    app.log.warn({ root: options.root }, 'frontend build not found; serving API only')
    return
  }

  await app.register(fastifyStatic, { root: options.root, wildcard: false })

  // Read once at boot: the shell never changes while the process runs, and
  // this keeps the not-found handler synchronous.
  const shell = readFileSync(join(options.root, 'index.html'), 'utf8')
  app.spaFallback = () => shell
}
