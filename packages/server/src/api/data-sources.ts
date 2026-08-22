/**
 * Table data sources.
 *
 * The destructive operations differ on purpose:
 *
 *   - **Replacing** a table can name the column that disappeared and the
 *     designs that referenced it. That is worth stopping for.
 *   - **Deleting** one can say neither — the whole table is gone — so the
 *     confirmation would only be able to say "are you sure". It is confirmed
 *     for the rows it destroys, not for who was using it, and a design left
 *     dangling is shown a warning instead (FR-028, FR-028a).
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import multipart from '@fastify/multipart'
import { DataSourceRepo } from '../db/repositories/data-source-repo.ts'
import type { DataSource } from '../domain/data-source.ts'
import {
  MAX_ROWS,
  UnknownColumnError,
  assertKnownColumns,
  dataSourceNameSchema,
  rowPatchSchema,
} from '../domain/data-source.ts'
import {
  CsvDuplicateColumnError,
  CsvNoHeaderError,
  CsvTooManyRowsError,
  importCsv,
  type ImportOptions,
} from '../csv/import.ts'
import { DecodeFailedError } from '../csv/encoding.ts'
import { templatesBrokenByRemoving, templatesUsingDataSource } from '../domain/template-refs.ts'
import { ApiError, HttpStatus } from './errors.ts'
import { asApiError, readByWorksheetId, requireSheets, tableOrRefuse } from './google.ts'
import { SheetsError } from '../domain/google-sheets.ts'
import { tableFromValues, TableShapeError } from '../domain/sheet-table.ts'
import { decideRefresh } from '../domain/refresh.ts'
import { templatesBrokenByRemoving as brokenBy } from '../domain/template-refs.ts'

/** A ten-thousand-row CSV of long Chinese values still fits comfortably. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

const idParams = z.object({ id: z.string().min(1) })
/**
 * `pageSize` reaches the table's own ceiling on purpose.
 *
 * The editor is a spreadsheet: it scrolls, it does not page, so it asks for
 * every row at once and virtualises the rendering. Ten thousand rows of a few
 * short columns is a couple of megabytes over a LAN — cheaper than the paging
 * state a spreadsheet would need to fake, and paging is what made copying a
 * block across a page boundary impossible.
 *
 * The row *selector* in the print dialog still pages, because there the pages
 * are how somebody reads the table.
 */
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_ROWS).default(10),
})

/** Turn an import failure into the error contract's three-part message. */
function importFailure(err: unknown): never {
  if (err instanceof CsvNoHeaderError) {
    throw ApiError.unprocessable('CSV_NO_HEADER', { column: err.blankAt + 1 })
  }
  if (err instanceof CsvDuplicateColumnError) {
    throw ApiError.unprocessable('CSV_DUPLICATE_COLUMN', { columns: err.columns })
  }
  if (err instanceof CsvTooManyRowsError) {
    throw ApiError.unprocessable('CSV_TOO_MANY_ROWS', { rowCount: err.rowCount, maxRows: err.maxRows })
  }
  if (err instanceof DecodeFailedError) {
    throw ApiError.unprocessable('CSV_DECODE_FAILED', { tried: err.tried })
  }
  throw err
}

interface Upload {
  bytes: Uint8Array
  name: string | undefined
  options: ImportOptions
}

/** Read the one file plus the text fields that ride alongside it. */
async function readUpload(request: {
  parts: () => AsyncIterableIterator<
    | { type: 'file'; toBuffer: () => Promise<Buffer>; filename: string }
    | { type: 'field'; fieldname: string; value: unknown }
  >
}): Promise<Upload> {
  let bytes: Uint8Array | null = null
  let filename = ''
  let name: string | undefined
  const options: ImportOptions = {}

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      bytes = new Uint8Array(await part.toBuffer())
      filename = part.filename
      continue
    }
    const value = String(part.value)
    if (part.fieldname === 'name') name = value
    if (part.fieldname === 'encoding' && value.length > 0) options.encoding = value
    if (part.fieldname === 'delimiter' && value.length > 0) {
      options.delimiter = value as ImportOptions['delimiter']
    }
  }

  if (bytes === null) {
    throw ApiError.unprocessable('VALIDATION_FAILED', { field: 'file' })
  }

  return {
    bytes,
    // Defaults to the file's own name, which is nearly always what the table
    // should be called and saves a decision at the moment of import (FR-020).
    name: name !== undefined && name.trim().length > 0 ? name.trim() : filename.replace(/\.[^.]+$/, ''),
    options,
  }
}

/**
 * A data source as the wire sees it.
 *
 * The domain keeps the origin in a nested `link`, because it is one thing that
 * is either wholly there or wholly absent. The wire flattens it: existing
 * clients read `columns` and `rowCount` off the top level, and burying the new
 * fields one layer down would make them look like a different kind of object.
 * Local sources carry `sourceKind` and nothing else new.
 */
export function serialiseSource(source: DataSource): Record<string, unknown> {
  const { link, ...rest } = source
  return link === null ? rest : { ...rest, ...link }
}

export async function registerDataSourceRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })

  const typed = app.withTypeProvider<ZodTypeProvider>()
  const sources = (): DataSourceRepo =>
    new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })

  const require = (repo: DataSourceRepo, id: string) => {
    const source = repo.find(id)
    if (source === undefined) {
      throw ApiError.notFound({ dataSourceId: id })
    }
    return source
  }

  typed.get('/api/data-sources', async () => ({ dataSources: sources().list().map(serialiseSource) }))

  typed.get(
    '/api/data-sources/:id/rows',
    { schema: { params: idParams, querystring: pageQuery } },
    async (request) => {
      const repo = sources()
      const source = require(repo, request.params.id)
      const { page, pageSize } = request.query
      return {
        rows: repo.page(source.id, page, pageSize),
        page,
        pageSize,
        total: source.rowCount,
      }
    },
  )

  app.post('/api/data-sources', async (request, reply) => {
    const upload = await readUpload(request as never)
    const repo = sources()

    let table
    try {
      table = importCsv(upload.bytes, upload.options)
    } catch (err) {
      importFailure(err)
    }

    const name = upload.name ?? ''
    const parsedName = dataSourceNameSchema.safeParse(name)
    if (!parsedName.success) {
      throw ApiError.unprocessable('VALIDATION_FAILED', { field: 'name' })
    }
    if (repo.findByName(parsedName.data) !== undefined) {
      throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: parsedName.data })
    }

    const created = repo.create({ name: parsedName.data, columns: table.columns, rows: table.rows })
    return reply
      .status(HttpStatus.Created)
      .send({ ...created, encoding: table.encoding, delimiter: table.delimiter })
  })

  /**
   * Create a data source backed by a Google worksheet.
   *
   * Reads the worksheet again rather than trusting anything the preview
   * returned: the browser is not a place to keep a table between two requests,
   * and reading twice is what makes "what you confirmed is what got stored"
   * true by construction rather than by hope.
   */
  typed.post(
    '/api/data-sources/google',
    {
      schema: {
        body: z.object({
          spreadsheetId: z.string().min(1),
          worksheetId: z.number().int(),
          name: dataSourceNameSchema,
        }),
      },
    },
    async (request, reply) => {
      const sheets = requireSheets(app.ctx)
      const repo = sources()
      if (repo.findByName(request.body.name) !== undefined) {
        throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: request.body.name })
      }

      let read
      try {
        read = await readByWorksheetId(sheets, request.body.spreadsheetId, request.body.worksheetId)
      } catch (err) {
        asApiError(err, sheets.clientEmail)
      }
      const table = tableOrRefuse(read.values)

      return reply.status(HttpStatus.Created).send(
        serialiseSource(repo.createLinked({
          name: request.body.name,
          columns: table.columns,
          rows: table.rows,
          link: {
            spreadsheetId: request.body.spreadsheetId,
            spreadsheetTitle: read.spreadsheetTitle,
            worksheetId: request.body.worksheetId,
            worksheetTitle: read.worksheetTitle,
          },
        })),
      )
    },
  )

  /**
   * In-flight refreshes, by data source id.
   *
   * Two writers on one table is how a half-replaced table happens: new columns
   * with old rows, or rows from two different reads. The browser disables its
   * button, but this service has no authentication and anybody on the network
   * can call the endpoint directly — so the guard has to be here as well.
   */
  const refreshing = new Set<string>()

  typed.post(
    '/api/data-sources/:id/refresh',
    {
      schema: {
        params: idParams,
        body: z.object({ confirmColumnChange: z.boolean().optional() }).default({}),
      },
    },
    async (request) => {
      const repo = sources()
      const source = require(repo, request.params.id)
      if (source.link === null) {
        throw ApiError.unprocessable('DATA_SOURCE_NOT_LINKED', { dataSourceId: source.id })
      }
      const sheets = requireSheets(app.ctx)

      if (refreshing.has(source.id)) {
        throw ApiError.conflict('DATA_SOURCE_REFRESH_IN_PROGRESS', { dataSourceId: source.id })
      }
      refreshing.add(source.id)
      try {
        let read
        try {
          read = await readByWorksheetId(sheets, source.link.spreadsheetId, source.link.worksheetId)
        } catch (err) {
          if (err instanceof SheetsError) {
            // Not an error response: the server did what it was asked and has a
            // conclusion. The rows that are already here still print, and a 5xx
            // would invite the browser to retry something that is not retryable.
            return { outcome: 'failed' as const, reason: err.kind }
          }
          throw err
        }

        let table
        try {
          table = tableFromValues(read.values)
        } catch (err) {
          if (err instanceof TableShapeError) {
            return { outcome: 'failed' as const, reason: 'worksheetMissing' as const, detail: err.message }
          }
          throw err
        }

        const decision = decideRefresh(source, table, {
          confirmed: request.body.confirmColumnChange === true,
        })

        if (decision.kind === 'refusedTooManyRows') {
          return { outcome: 'refusedTooManyRows' as const, ...decision, kind: undefined }
        }
        if (decision.kind === 'needsConfirmation') {
          return {
            outcome: 'needsConfirmation' as const,
            removedColumns: decision.removedColumns,
            addedColumns: decision.addedColumns,
            // Computed on read, never stored — the same rule bindingIssue
            // follows, and for the same reason.
            affectedTemplates: brokenBy(app.ctx.db, source.id, decision.removedColumns),
          }
        }

        const rowsBefore = source.rowCount
        repo.replaceLinked(source.id, {
          columns: table.columns,
          rows: table.rows,
          worksheetTitle: read.worksheetTitle,
        })
        const after = require(repo, source.id)
        return {
          outcome: 'applied' as const,
          rowsBefore,
          rowsAfter: after.rowCount,
          columnsAdded: decision.columnsAdded,
          lastRefreshedAt: after.link?.lastRefreshedAt ?? null,
        }
      } finally {
        refreshing.delete(source.id)
      }
    },
  )

  typed.patch(
    '/api/data-sources/:id',
    { schema: { params: idParams, body: z.object({ name: dataSourceNameSchema }) } },
    async (request) => {
      // Renaming changes nothing else. Designs bind by id, and column
      // references never carried the source name — so there is deliberately no
      // "these designs will break" prompt here: none of them will.
      const repo = sources()
      require(repo, request.params.id)
      const clash = repo.findByName(request.body.name)
      if (clash !== undefined && clash.id !== request.params.id) {
        throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: request.body.name })
      }
      repo.rename(request.params.id, request.body.name)
      return serialiseSource(require(repo, request.params.id))
    },
  )

  app.post<{ Params: { id: string }; Querystring: { confirm?: string } }>(
    '/api/data-sources/:id/replace',
    async (request, reply) => {
      const repo = sources()
      const source = require(repo, request.params.id)
      const upload = await readUpload(request as never)

      let table
      try {
        table = importCsv(upload.bytes, upload.options)
      } catch (err) {
        importFailure(err)
      }

      const removed = source.columns.filter((column) => !table.columns.includes(column))
      const affected = templatesBrokenByRemoving(app.ctx.db, source.id, removed)

      if (affected.length > 0 && request.query.confirm !== 'true') {
        // Names the column and the designs. That is the information worth
        // stopping for; a bare "are you sure" would not be.
        throw ApiError.conflict('DATA_SOURCE_COLUMNS_REMOVED', {
          removedColumns: removed,
          affectedTemplates: affected,
        })
      }

      repo.replace(source.id, table.columns, table.rows)
      return reply
        .status(HttpStatus.Ok)
        .send({ ...serialiseSource(require(repo, source.id)), encoding: table.encoding, delimiter: table.delimiter })
    },
  )

  typed.patch(
    '/api/data-sources/:id/rows',
    { schema: { params: idParams, body: rowPatchSchema } },
    async (request) => {
      const repo = sources()
      const source = require(repo, request.params.id)

      try {
        for (const upsert of request.body.upserts) {
          assertKnownColumns(source.columns, upsert.values)
        }
      } catch (err) {
        if (err instanceof UnknownColumnError) {
          throw ApiError.unprocessable('DATA_SOURCE_UNKNOWN_COLUMN', { columns: err.columns })
        }
        throw err
      }

      try {
        repo.patchRows(source.id, request.body)
      } catch (err) {
        if (err instanceof Error && err.name === 'TooManyRowsError') {
          throw ApiError.unprocessable('CSV_TOO_MANY_ROWS', { maxRows: 10_000 })
        }
        throw err
      }

      return serialiseSource(require(repo, source.id))
    },
  )

  typed.delete(
    '/api/data-sources/:id',
    { schema: { params: idParams, querystring: z.object({ confirm: z.string().optional() }) } },
    async (request, reply) => {
      const repo = sources()
      const source = require(repo, request.params.id)

      if (request.query.confirm !== 'true') {
        // Confirmed for the rows it destroys, which cannot be recovered — not
        // for who is using it. A design left dangling is recoverable: rebind it
        // to another table of the same shape and every reference resolves again.
        throw ApiError.unprocessable('DATA_SOURCE_DELETE_NOT_CONFIRMED', {
          dataSourceId: source.id,
          rowCount: source.rowCount,
          affectedTemplates: templatesUsingDataSource(app.ctx.db, source.id),
        })
      }

      repo.delete(source.id)
      return reply.status(HttpStatus.NoContent).send()
    },
  )
}
