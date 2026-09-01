/**
 * The seam between this system and whatever is producing rows over HTTP.
 *
 * Same shape and the same reason as `SheetsPort`: everything the feature needs
 * from the other end passes through one narrow port, so the whole default test
 * suite runs with no network and no server to stand up. A wide port would
 * become a second HTTP client to maintain; this one has two fields and a
 * promise.
 *
 * The port deals in transport — a status and a parsed body — and knows nothing
 * about rows. Deciding whether a body is a table is this module's job, and
 * keeping that out of the port is what lets the fake be trusted.
 */
import { rowEnvelopeSchema, declaredTotal, nextOffset, type RowEnvelope } from '@zenith/shared'
import { MAX_ROWS } from './data-source.ts'

export interface HttpRowsRequest {
  url: string
  headers: Record<string, string>
}

export interface HttpRowsResponse {
  status: number
  /** Parsed JSON, or undefined when the body was not JSON at all. */
  body: unknown
}

export interface HttpRowsPort {
  get(request: HttpRowsRequest): Promise<HttpRowsResponse>
}

/**
 * Why a fetch failed, as a closed set.
 *
 * Closed because each member becomes a sentence somebody reads and acts on.
 * "It didn't work" is not something anybody can act on, and a producer that is
 * refusing the credential needs a different response from one that is down.
 */
export const HTTP_SOURCE_ERROR_KINDS = [
  'unreachable',
  'badStatus',
  'badShape',
  'tooManyRows',
] as const
export type HttpSourceErrorKind = (typeof HTTP_SOURCE_ERROR_KINDS)[number]

export class HttpSourceError extends Error {
  readonly kind: HttpSourceErrorKind
  readonly detail: string
  readonly status: number | null

  constructor(kind: HttpSourceErrorKind, detail: string, status: number | null = null) {
    super(`${kind}: ${detail}`)
    this.name = 'HttpSourceError'
    this.kind = kind
    this.detail = detail
    this.status = status
  }
}

/**
 * The URL for one page.
 *
 * The configured URL is used verbatim for the first page — it may already carry
 * the producer's own filters, and rewriting it would be this system deciding
 * what the other end's query means. Later pages add `offset` and nothing else:
 * the producer chooses its own page size and reports it, and a `limit` we
 * imposed would be a second opinion about a number only it can honour.
 */
export function pageUrl(configured: string, offset: number): string {
  if (offset === 0) {
    return configured
  }
  const url = new URL(configured)
  url.searchParams.set('offset', String(offset))
  return url.toString()
}

function parseEnvelope(body: unknown): RowEnvelope {
  const parsed = rowEnvelopeSchema.safeParse(body)
  if (parsed.success) {
    return parsed.data
  }
  // The first problem, located. A wall of zod issues is not a sentence.
  const issue = parsed.error.issues[0]
  const where = (issue?.path ?? []).join('.')
  const message = issue?.message ?? 'unrecognised'
  throw new HttpSourceError('badShape', where.length > 0 ? `${where}: ${message}` : message)
}

export interface FetchedRows {
  columns: string[]
  rows: Array<Record<string, string>>
  /** What the producer said the total was, for the log line. */
  total: number
}

/**
 * Fetch every row the producer has, following its paging.
 *
 * The row ceiling is checked against the producer's declared total **before**
 * paging through it, not after: refusing at the end means having already pulled
 * a hundred thousand rows into memory to find out they were too many, which is
 * the failure the ceiling exists to prevent.
 */
export async function fetchAllRows(
  port: HttpRowsPort,
  request: HttpRowsRequest,
  limit = MAX_ROWS,
): Promise<FetchedRows> {
  const collected: Array<Record<string, string>> = []
  let columns: string[] | null = null
  let offset = 0

  for (;;) {
    let response: HttpRowsResponse
    try {
      response = await port.get({ url: pageUrl(request.url, offset), headers: request.headers })
    } catch (err) {
      throw new HttpSourceError('unreachable', err instanceof Error ? err.message : String(err))
    }

    if (response.status < 200 || response.status >= 300) {
      throw new HttpSourceError('badStatus', `HTTP ${response.status}`, response.status)
    }

    const page = parseEnvelope(response.body)
    const total = declaredTotal(page)
    if (total > limit) {
      throw new HttpSourceError('tooManyRows', `${total} > ${limit}`)
    }

    // The first page decides the columns. A later page that disagreed would
    // mean the producer changed its mind mid-read, and stitching the two
    // together would produce rows the envelope's own rule forbids.
    if (columns === null) {
      columns = page.columns
    } else if (page.columns.join(' ') !== columns.join(' ')) {
      throw new HttpSourceError('badShape', 'the columns changed between pages')
    }

    collected.push(...page.rows)
    if (collected.length > limit) {
      throw new HttpSourceError('tooManyRows', `${collected.length} > ${limit}`)
    }

    const next = nextOffset(page, collected.length)
    if (next === null) {
      return { columns, rows: collected, total }
    }
    if (next <= offset) {
      // A producer whose offset does not advance would spin here forever.
      throw new HttpSourceError('badShape', `paging did not advance past offset ${offset}`)
    }
    offset = next
  }
}
