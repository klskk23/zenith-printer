/**
 * Serve the built frontend from the same process as the API.
 *
 * Single-process deployment (plan.md): one systemd unit, no reverse proxy,
 * no separate frontend host. Unknown non-API paths fall through to index.html
 * so client-side routing works on a hard refresh.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
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
  const shellPath = join(options.root, 'index.html')
  const shell = readFileSync(shellPath, 'utf8')
  app.spaFallback = () => shell

  /**
   * Say which build is being served, and how old it is.
   *
   * This process hands out whatever `dist` happens to be on disk. A source fix
   * that has not been rebuilt is therefore invisible: the code is correct, the
   * running page is not, and nothing anywhere says so. That exact confusion
   * cost a round trip once — a bug was reported as unfixed while the fix sat
   * in the source, five minutes newer than the bundle being served.
   */
  const builtAt = statSync(shellPath).mtime
  const ageMinutes = Math.round((Date.now() - builtAt.getTime()) / 60_000)
  app.log.info(
    { root: options.root, builtAt: builtAt.toISOString(), ageMinutes },
    'serving frontend build',
  )

  /** For "am I looking at my change?" — answerable without reading the logs. */
  app.get('/api/frontend-build', async () => ({
    builtAt: builtAt.toISOString(),
    ageMinutes: Math.round((Date.now() - builtAt.getTime()) / 60_000),
  }))
}
