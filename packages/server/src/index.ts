/**
 * Process entry point.
 *
 * Access is limited to the LAN or a VPN. The service does no authentication —
 * anyone who can reach it can submit and cancel jobs — so binding it to a
 * public interface would be a mistake, not a configuration choice.
 */
import { join } from 'node:path'
import { repoRoot } from './paths.ts'
import { googleCredentialsPath } from './config.ts'
import { createGoogleSheetsClient } from './integrations/google-sheets-client.ts'
import { buildApp } from './app.ts'
import { openDatabase } from './db/index.ts'
import { registerStatic } from './static.ts'
import { createNexusClient } from './integrations/nexus-client.ts'


const HOST = process.env.ZENITH_HOST ?? '0.0.0.0'
const PORT = Number(process.env.ZENITH_PORT ?? 3000)
const DB_PATH = process.env.ZENITH_DB ?? join(repoRoot, 'data', 'zenith.db')
const WEB_ROOT = process.env.ZENITH_WEB_ROOT ?? join(repoRoot, 'packages/web/dist')
const UPLOAD_DIR = process.env.ZENITH_UPLOADS ?? join(repoRoot, 'data', 'uploads')

/**
 * The Google client, or nothing at all.
 *
 * A bad key file is reported and then ignored rather than stopping the
 * service: label printing does not depend on Google, and refusing to start
 * because a spreadsheet integration is misconfigured would take the printer
 * down with it.
 */
function sheetsFrom(log: (message: string) => void) {
  const credentialsPath = googleCredentialsPath()
  if (credentialsPath === undefined) {
    return undefined
  }
  try {
    const client = createGoogleSheetsClient({ credentialsPath })
    return { port: client, clientEmail: client.clientEmail }
  } catch (err) {
    log(err instanceof Error ? err.message : String(err))
    return undefined
  }
}

/**
 * The asset ledger client, or nothing at all.
 *
 * Both variables or neither. A URL with no key would produce an entry point
 * that appears and then fails on the first click with a 401, which is a worse
 * answer than not appearing: "not configured" is a thing somebody can fix, and
 * a button that lies is not.
 *
 * Reported and then ignored on the way past, like the Google credentials:
 * printing labels does not depend on the ledger, and refusing to start because
 * an integration is half-configured would take the printer down with it.
 */
function nexusFrom(log: (message: string) => void) {
  const baseUrl = process.env.NEXUS_ASSETS_SERVICE_URL
  const apiKey = process.env.NEXUS_ASSETS_SERVICE_API_KEY
  if (baseUrl === undefined && apiKey === undefined) {
    return undefined
  }
  if (baseUrl === undefined || apiKey === undefined) {
    log(
      'NEXUS_ASSETS_SERVICE_URL and NEXUS_ASSETS_SERVICE_API_KEY must be set together; ' +
        'the asset ledger integration is off',
    )
    return undefined
  }
  return { port: createNexusClient({ baseUrl, apiKey }), baseUrl }
}

async function main(): Promise<void> {
  const db = openDatabase({ location: DB_PATH })
  const problems: string[] = []
  const app = buildApp({
    db,
    imageStorageDir: UPLOAD_DIR,
    logLevel: (process.env.LOG_LEVEL as 'info') ?? 'info',
    nexus: nexusFrom((message) => problems.push(message)),
    ...(() => {
      const sheets = sheetsFrom((message) => problems.push(message))
      return sheets === undefined ? {} : { sheets }
    })(),
  })
  for (const problem of problems) {
    app.log.warn({ event: 'google_credentials_unusable', problem }, 'google sheets disabled')
  }

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
