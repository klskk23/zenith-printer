/**
 * Linking a Google spreadsheet: is it configured, what worksheets are there,
 * and what would this one look like as a data source.
 *
 * Nothing here creates anything. The preview exists so somebody can see the
 * column names before they become reference names — a spreadsheet whose header
 * is not on the first row is obvious at a glance here, and invisible until a
 * label prints otherwise.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { DataSourceRepo } from '../db/repositories/data-source-repo.ts'
import { MAX_ROWS } from '../domain/data-source.ts'
import { SheetsError, spreadsheetIdFrom } from '../domain/google-sheets.ts'
import { TableShapeError, tableFromValues } from '../domain/sheet-table.ts'
import { ApiError, HttpStatus } from './errors.ts'
import type { AppContext } from '../app.ts'

/** How many rows the confirmation step shows. Enough to spot a wrong header. */
const SAMPLE_ROWS = 3

/**
 * The configured Google access, or a refusal that says what is missing.
 *
 * Checked at the top of every handler rather than once at registration: the
 * routes exist either way, so that "not configured" is an answer the UI can
 * show rather than a 404 it has to guess about.
 */
export function requireSheets(ctx: AppContext): NonNullable<AppContext['sheets']> {
  if (ctx.sheets === null) {
    throw ApiError.unprocessable('GOOGLE_NOT_CONFIGURED', {})
  }
  return ctx.sheets
}

/**
 * Turn a port failure into an HTTP answer.
 *
 * `notShared` carries the robot's address: it is the most common first failure
 * of this whole feature, and "permission denied" sends somebody to look at the
 * spreadsheet while the address sends them to fix it.
 */
export function asApiError(error: unknown, clientEmail: string): never {
  if (!(error instanceof SheetsError)) {
    throw error
  }
  switch (error.kind) {
    case 'notShared':
      throw ApiError.unprocessable('GOOGLE_NOT_SHARED', { clientEmail })
    case 'notFound':
      // Also mentions sharing: whether Google returns 403 or 404 for a
      // spreadsheet that exists but was never shared is not settled by the
      // documentation, and is checked by hand (quickstart, HW-2). Until then
      // this wording covers both, because guessing wrong sends the operator to
      // check whether the file was deleted.
      throw ApiError.fromCode(HttpStatus.NotFound, 'GOOGLE_SPREADSHEET_NOT_FOUND', { clientEmail })
    case 'worksheetMissing':
      throw ApiError.unprocessable('GOOGLE_WORKSHEET_NOT_FOUND', {})
    case 'credentialsInvalid':
      throw ApiError.unprocessable('GOOGLE_CREDENTIALS_INVALID', {})
    case 'rateLimited':
      throw ApiError.fromCode(HttpStatus.TooManyRequests, 'GOOGLE_RATE_LIMITED', {})
    case 'unreachable':
    case 'timeout':
      throw ApiError.fromCode(HttpStatus.GatewayTimeout, 'GOOGLE_UNREACHABLE', {})
  }
}

/** Read a worksheet by its stable id, resolving the title Sheets needs. */
export async function readByWorksheetId(
  sheets: NonNullable<AppContext['sheets']>,
  spreadsheetId: string,
  worksheetId: number,
): Promise<{ spreadsheetTitle: string; worksheetTitle: string; values: string[][] }> {
  const info = await sheets.port.listWorksheets(spreadsheetId)
  const worksheet = info.worksheets.find((sheet) => sheet.id === worksheetId)
  if (worksheet === undefined) {
    // The worksheet id is what we stored; the title is what the read endpoint
    // addresses. A rename in Google changes the title and not the id, so this
    // lookup is what keeps a renamed worksheet readable.
    throw ApiError.unprocessable('GOOGLE_WORKSHEET_NOT_FOUND', {})
  }
  return {
    spreadsheetTitle: info.title,
    worksheetTitle: worksheet.title,
    values: await sheets.port.readWorksheet(spreadsheetId, worksheet.title),
  }
}

/** Turn a worksheet's values into a table, mapping shape problems to API codes. */
export function tableOrRefuse(values: string[][]): ReturnType<typeof tableFromValues> {
  let table
  try {
    table = tableFromValues(values)
  } catch (err) {
    if (err instanceof TableShapeError) {
      if (err.reason === 'duplicate') {
        // The same code the CSV importer uses. The rule and the wording are
        // identical, and inventing a synonym would give one situation two
        // descriptions.
        throw ApiError.unprocessable('CSV_DUPLICATE_COLUMN', { reason: err.message })
      }
      throw ApiError.unprocessable('GOOGLE_WORKSHEET_EMPTY', { reason: err.message })
    }
    throw err
  }
  if (table.rows.length > MAX_ROWS) {
    throw ApiError.unprocessable('CSV_TOO_MANY_ROWS', { rowCount: table.rows.length, limit: MAX_ROWS })
  }
  return table
}

export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const sources = (): DataSourceRepo =>
    new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })

  typed.get('/api/google/status', async () => ({
    configured: app.ctx.sheets !== null,
    clientEmail: app.ctx.sheets?.clientEmail ?? null,
  }))

  typed.post(
    '/api/google/worksheets',
    { schema: { body: z.object({ url: z.string() }) } },
    async (request) => {
      const sheets = requireSheets(app.ctx)
      const spreadsheetId = spreadsheetIdFrom(request.body.url)
      if (spreadsheetId === null) {
        throw ApiError.fromCode(HttpStatus.BadRequest, 'GOOGLE_URL_INVALID', {})
      }
      try {
        const info = await sheets.port.listWorksheets(spreadsheetId)
        return { spreadsheetId, spreadsheetTitle: info.title, worksheets: info.worksheets }
      } catch (err) {
        asApiError(err, sheets.clientEmail)
      }
    },
  )

  typed.post(
    '/api/google/preview',
    {
      schema: {
        body: z.object({ spreadsheetId: z.string().min(1), worksheetId: z.number().int() }),
      },
    },
    async (request) => {
      const sheets = requireSheets(app.ctx)
      let read
      try {
        read = await readByWorksheetId(sheets, request.body.spreadsheetId, request.body.worksheetId)
      } catch (err) {
        asApiError(err, sheets.clientEmail)
      }

      const table = tableOrRefuse(read.values)
      return {
        spreadsheetTitle: read.spreadsheetTitle,
        worksheetTitle: read.worksheetTitle,
        columns: table.columns,
        sampleRows: table.rows.slice(0, SAMPLE_ROWS),
        totalRows: table.rows.length,
        // The worksheet's own name is the obvious default; whether it is free
        // is said here rather than after the fact, so a clash is a correction
        // and not a failed create.
        suggestedName: read.worksheetTitle,
        nameTaken: sources().findByName(read.worksheetTitle) !== undefined,
      }
    },
  )
}
