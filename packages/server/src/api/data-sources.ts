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
  httpSourceInputSchema,
  httpSourcePatchSchema,
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
import { HttpSourceError, fetchAllRows } from '../domain/http-rows.ts'
import { DuplicateRowKeyError, MissingRowKeyError, keyRows } from '../domain/row-upsert.ts'
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
  /**
   * Which end of the table to page from. A viewing order, nothing more.
   *
   * Printing always goes by ascending ordinal — see the print-order rule — so
   * this changes what is on screen and never what comes out of the printer.
   */
  order: z.enum(['asc', 'desc']).default('asc'),
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

/**
 * Refresh a source that reads from an address.
 *
 * Deliberately unlike the Google path in one respect. A Google read that fails
 * comes back as `{ outcome: 'failed' }` with a 200, because the server did what
 * it was asked and has a conclusion to report. Here the failures are the
 * caller's to act on — an address that no longer exists, a credential the other
 * end stopped accepting, a body that is not a table — and each has a repair. So
 * they are errors with stable codes and three-part copy, which is what the
 * calling system shows to a person.
 *
 * What is *not* an error: the rows already stored. Every failure below leaves
 * them exactly as they were, and every message says so. A table that cannot be
 * refreshed can still be printed from, and refusing to print because a producer
 * is down would be this system inventing an outage of its own.
 */
/**
 * In-flight refreshes, by data source id.
 *
 * Two writers on one table is how a half-replaced table happens: new columns
 * with old rows, or rows from two different reads. The browser disables its
 * button, but this service has no authentication and anybody on the network can
 * call the endpoint directly — so the guard has to be here as well.
 *
 * Module scope rather than per-registration, because the submission path
 * refreshes too when a source asks it to, and two guards would guard nothing.
 */
const refreshing = new Set<string>()

export function isRefreshing(dataSourceId: string): boolean {
  return refreshing.has(dataSourceId)
}

export async function withRefreshLock<T>(dataSourceId: string, run: () => Promise<T>): Promise<T> {
  if (refreshing.has(dataSourceId)) {
    throw ApiError.conflict('DATA_SOURCE_REFRESH_IN_PROGRESS', { dataSourceId })
  }
  refreshing.add(dataSourceId)
  try {
    return await run()
  } finally {
    refreshing.delete(dataSourceId)
  }
}

export async function refreshFromAddress(
  app: FastifyInstance,
  repo: DataSourceRepo,
  source: DataSource,
  confirmed: boolean,
): Promise<Record<string, unknown>> {
  const log = (conclusion: Record<string, unknown>): void => {
    // Never the row values: business data does not belong in logs, the same
    // boundary the credentials rule guards from the other side.
    app.log.info(
      { event: 'data_source_refresh', dataSourceId: source.id, sourceKind: 'http', ...conclusion },
      'data source refresh',
    )
  }

  if (source.http === null || source.keyColumn === null) {
    throw ApiError.unprocessable('DATA_SOURCE_NOT_FETCHABLE', { dataSourceId: source.id })
  }

  let fetched
  try {
    fetched = await fetchAllRows(app.ctx.httpRows, {
      url: source.http.url,
      headers: repo.httpHeaders(source.id),
    })
  } catch (err) {
    if (err instanceof HttpSourceError) {
      log({ outcome: 'failed', reason: err.kind, detail: err.detail })
      if (err.kind === 'tooManyRows') {
        return { outcome: 'refusedTooManyRows' as const, rowCount: Number(err.detail.split(' ')[0]), limit: MAX_ROWS }
      }
      const code =
        err.kind === 'unreachable'
          ? 'HTTP_SOURCE_UNREACHABLE'
          : err.kind === 'badStatus'
            ? 'HTTP_SOURCE_BAD_STATUS'
            : 'HTTP_SOURCE_BAD_SHAPE'
      throw ApiError.unprocessable(code, {
        dataSourceId: source.id,
        detail: err.detail,
        ...(err.status === null ? {} : { status: err.status }),
      })
    }
    throw err
  }

  /**
   * Checked before the column change is, and not confirmable.
   *
   * Losing the key column is not one more removed column. Confirming a header
   * change is consent to lose *a column*; it is not consent to go back to
   * identifying rows by position, which is what proceeding without a key would
   * do — and would do silently, since the table would still look full.
   */
  if (!fetched.columns.includes(source.keyColumn)) {
    log({ outcome: 'failed', reason: 'keyColumnMissing' })
    throw ApiError.unprocessable('HTTP_SOURCE_MISSING_KEY', {
      dataSourceId: source.id,
      keyColumn: source.keyColumn,
    })
  }

  const decision = decideRefresh(source, fetched, { confirmed })
  if (decision.kind === 'refusedTooManyRows') {
    log({ outcome: 'refusedTooManyRows', rowCount: decision.rowCount, limit: decision.limit })
    return { outcome: 'refusedTooManyRows' as const, rowCount: decision.rowCount, limit: decision.limit }
  }
  if (decision.kind === 'needsConfirmation') {
    log({ outcome: 'needsConfirmation', removedColumns: decision.removedColumns })
    return {
      outcome: 'needsConfirmation' as const,
      removedColumns: decision.removedColumns,
      addedColumns: decision.addedColumns,
      affectedTemplates: brokenBy(app.ctx.db, source.id, decision.removedColumns),
    }
  }

  let keyed
  try {
    keyed = keyRows(fetched.rows, source.keyColumn)
  } catch (err) {
    if (err instanceof DuplicateRowKeyError) {
      log({ outcome: 'failed', reason: 'duplicateKey', duplicates: err.duplicates.length })
      throw ApiError.unprocessable('HTTP_SOURCE_DUPLICATE_KEY', {
        dataSourceId: source.id,
        keyColumn: err.column,
        duplicates: err.duplicates,
      })
    }
    if (err instanceof MissingRowKeyError) {
      log({ outcome: 'failed', reason: 'missingKey', rowIndex: err.rowIndex })
      throw ApiError.unprocessable('HTTP_SOURCE_MISSING_KEY', {
        dataSourceId: source.id,
        keyColumn: err.column,
        rowIndex: err.rowIndex + 1,
      })
    }
    throw err
  }

  const rowsBefore = source.rowCount
  const merged = repo.upsertByKey(source.id, { columns: fetched.columns, rows: keyed })
  const after = repo.find(source.id)
  log({ outcome: 'applied', rowsBefore, rowsAfter: after?.rowCount ?? 0, ...merged })

  return {
    outcome: 'applied' as const,
    rowsBefore,
    rowsAfter: after?.rowCount ?? 0,
    columnsAdded: decision.columnsAdded,
    // What the merge did, which "applied" alone cannot say. A refresh that
    // changed nothing and one that replaced the table are different answers.
    added: merged.added,
    updated: merged.updated,
    removed: merged.removed,
    lastRefreshedAt: after?.lastRefreshedAt ?? null,
  }
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
      const { page, pageSize, order } = request.query
      return {
        rows: repo.page(source.id, page, pageSize, order === 'desc'),
        page,
        pageSize,
        order,
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
   * Create a data source that reads rows from an address.
   *
   * No rows are fetched here. Creating and reading are separate acts: a
   * producer that happens to be down should not stop the table being created,
   * and the refresh path already knows how to report every way a read can fail.
   * The table therefore starts empty and honestly says it has never refreshed.
   *
   * `keyColumn` is required, and is the whole reason this kind of source is
   * safe to have. See `domain/row-upsert.ts`: without it a row's identity is
   * its position, and a producer that inserts a row moves every selection made
   * against the rows below it, silently.
   */
  typed.post(
    '/api/data-sources/http',
    { schema: { body: httpSourceInputSchema } },
    async (request, reply) => {
      const repo = sources()
      if (repo.findByName(request.body.name) !== undefined) {
        throw ApiError.conflict('DATA_SOURCE_NAME_TAKEN', { name: request.body.name })
      }
      if (request.body.refreshBeforePrint === true && request.body.keyColumn.length === 0) {
        throw ApiError.unprocessable('HTTP_SOURCE_KEY_COLUMN_REQUIRED', { name: request.body.name })
      }

      return reply.status(HttpStatus.Created).send(
        serialiseSource(
          repo.createHttp({
            name: request.body.name,
            // The producer is the authority on what the columns are; until it
            // has been read there is nothing to claim, and claiming the key
            // column alone would describe a table that does not exist yet.
            columns: [request.body.keyColumn],
            url: request.body.url,
            headers: request.body.headers,
            keyColumn: request.body.keyColumn,
            refreshIntervalSeconds: request.body.refreshIntervalSeconds,
            refreshBeforePrint: request.body.refreshBeforePrint,
          }),
        ),
      )
    },
  )


  /**
   * Refuse to change the contents of a table that is a copy of somebody
   * else's.
   *
   * An edit here survives exactly until the next refresh replaces the table,
   * and then vanishes with nothing said. The browser disables the controls;
   * this is what makes it true, because the service has no authentication and
   * the endpoint is reachable directly.
   */
  const assertWritable = (source: DataSource): void => {
    if (source.sourceKind !== 'local') {
      throw ApiError.unprocessable('DATA_SOURCE_READ_ONLY', { dataSourceId: source.id })
    }
  }

  /**
   * Change how a source reads, without recreating it.
   *
   * Kept apart from the rename PATCH because these are a different kind of
   * change: a rename affects nothing, while any of these decides what the next
   * refresh does. `headers` absent leaves the stored credential alone — the
   * caller cannot read it back, so requiring them to resend it would mean
   * requiring them to know it.
   */
  typed.patch(
    '/api/data-sources/:id/http',
    {
      schema: {
        params: idParams,
        body: httpSourcePatchSchema,
      },
    },
    async (request) => {
      const repo = sources()
      const source = require(repo, request.params.id)
      if (source.sourceKind !== 'http') {
        throw ApiError.unprocessable('DATA_SOURCE_NOT_FETCHABLE', { dataSourceId: source.id })
      }

      const keyColumn = request.body.keyColumn ?? source.keyColumn
      if (request.body.refreshBeforePrint === true && (keyColumn === null || keyColumn.length === 0)) {
        // Without a key, a refresh at submission time moves the rows out from
        // under a selection already made — silently, and in the worst moment.
        throw ApiError.unprocessable('HTTP_SOURCE_KEY_COLUMN_REQUIRED', { dataSourceId: source.id })
      }

      repo.setRefreshPolicy(source.id, {
        refreshIntervalSeconds: request.body.refreshIntervalSeconds,
        refreshBeforePrint: request.body.refreshBeforePrint,
        url: request.body.url,
        headers: request.body.headers,
        keyColumn: request.body.keyColumn,
      })
      return serialiseSource(require(repo, source.id))
    },
  )

  typed.post(
    '/api/data-sources/:id/unlink',
    { schema: { params: idParams, body: z.object({ confirmed: z.boolean().optional() }).default({}) } },
    async (request) => {
      const repo = sources()
      const source = require(repo, request.params.id)
      // Any source that reads from elsewhere, not only a spreadsheet: an http
      // source has no `link` and releasing it means exactly the same thing —
      // keep the rows, forget where they came from.
      if (source.sourceKind === 'local') {
        throw ApiError.unprocessable('DATA_SOURCE_NOT_LINKED', { dataSourceId: source.id })
      }
      if (request.body.confirmed !== true) {
        // Its own code and its own wording. A shared confirmation message once
        // told somebody unlinking a table that the operation would consume
        // label stock; a confirmation has to describe its own consequence.
        throw ApiError.unprocessable('DATA_SOURCE_UNLINK_NOT_CONFIRMED', {
          dataSourceName: source.name,
          rowCount: source.rowCount,
        })
      }
      repo.unlink(source.id)
      return serialiseSource(require(repo, source.id))
    },
  )

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

      if (refreshing.has(source.id)) {
        throw ApiError.conflict('DATA_SOURCE_REFRESH_IN_PROGRESS', { dataSourceId: source.id })
      }

      if (source.sourceKind === 'http') {
        refreshing.add(source.id)
        try {
          return await refreshFromAddress(app, repo, source, request.body.confirmColumnChange === true)
        } finally {
          refreshing.delete(source.id)
        }
      }

      if (source.link === null) {
        throw ApiError.unprocessable('DATA_SOURCE_NOT_LINKED', { dataSourceId: source.id })
      }
      const sheets = requireSheets(app.ctx)

      /**
       * One line per refresh, so "where did this batch of labels get its data"
       * has an answer months later (Principle V).
       *
       * Never the row values. Business data does not belong in logs, which is
       * the same boundary the credentials rule guards — a different door into
       * the same room.
       */
      const log = (conclusion: Record<string, unknown>): void => {
        app.log.info(
          { event: 'data_source_refresh', dataSourceId: source.id, ...conclusion },
          'data source refresh',
        )
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
            log({ outcome: 'failed', reason: err.kind })
            return { outcome: 'failed' as const, reason: err.kind }
          }
          throw err
        }

        let table
        try {
          table = tableFromValues(read.values)
        } catch (err) {
          if (err instanceof TableShapeError) {
            log({ outcome: 'failed', reason: 'worksheetMissing' })
            return { outcome: 'failed' as const, reason: 'worksheetMissing' as const, detail: err.message }
          }
          throw err
        }

        const decision = decideRefresh(source, table, {
          confirmed: request.body.confirmColumnChange === true,
        })

        if (decision.kind === 'refusedTooManyRows') {
          log({ outcome: 'refusedTooManyRows', rowCount: decision.rowCount, limit: decision.limit })
          return { outcome: 'refusedTooManyRows' as const, ...decision, kind: undefined }
        }
        if (decision.kind === 'needsConfirmation') {
          log({ outcome: 'needsConfirmation', removedColumns: decision.removedColumns })
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
        log({ outcome: 'applied', rowsBefore, rowsAfter: table.rows.length })
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
      assertWritable(source)
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
      assertWritable(source)

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
