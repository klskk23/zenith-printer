/**
 * Process entry point.
 *
 * Access is limited to the LAN or a VPN. The service does no authentication —
 * anyone who can reach it can submit and cancel jobs — so binding it to a
 * public interface would be a mistake, not a configuration choice.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.ts'
import { openDatabase } from './db/index.ts'
import { registerStatic } from './static.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const HOST = process.env.ZENITH_HOST ?? '0.0.0.0'
const PORT = Number(process.env.ZENITH_PORT ?? 3000)
const DB_PATH = process.env.ZENITH_DB ?? join(repoRoot, 'data', 'zenith.db')
const WEB_ROOT = process.env.ZENITH_WEB_ROOT ?? join(repoRoot, 'packages/web/dist')
const UPLOAD_DIR = process.env.ZENITH_UPLOADS ?? join(repoRoot, 'data', 'uploads')

async function main(): Promise<void> {
  const db = openDatabase({ location: DB_PATH })
  const app = buildApp({
    db,
    imageStorageDir: UPLOAD_DIR,
    logLevel: (process.env.LOG_LEVEL as 'info') ?? 'info',
  })

  await registerStatic(app, { root: WEB_ROOT })

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: HOST, port: PORT })
  app.log.warn('no authentication is configured; expose this service on a LAN or VPN only')
}

await main()
