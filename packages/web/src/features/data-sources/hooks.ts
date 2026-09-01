import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'

export interface DataSource {
  id: string
  name: string
  columns: string[]
  rowCount: number
  /**
   * Whether the rows are maintained here or come from somewhere else.
   *
   * A linked source is read-only locally: editing it here and having the next
   * refresh wipe that edit is the failure this distinction exists to prevent.
   */
  sourceKind: 'local' | 'google-sheets' | 'http'
  /** Present only when linked. Flattened onto the same object by the server. */
  spreadsheetId?: string
  spreadsheetTitle?: string
  worksheetId?: number
  worksheetTitle?: string
  /**
   * Present only for a source that reads from an address.
   *
   * Header **names** and no values: the server never returns those, because a
   * service with no authentication of its own must not hand back the means of
   * authenticating somewhere else.
   */
  http?: { url: string; headerNames: string[] }
  /** Which column names a row. Null where identity is still position. */
  keyColumn?: string | null
  /** 0 means "only when asked", which is what every source did before. */
  refreshIntervalSeconds?: number
  refreshBeforePrint?: boolean
  /** Null for a table nobody fetches, and for one nobody has fetched yet. */
  lastRefreshedAt?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Whether a table's rows come from somewhere else.
 *
 * The kinds are named rather than defined as "not local", so that a source
 * arriving without a kind — an older fixture, a response from a version that
 * did not send one — reads as an ordinary table rather than as a read-only one
 * nobody can edit and nothing can refresh.
 */
export function isFetched(source: Pick<DataSource, 'sourceKind'>): boolean {
  return source.sourceKind === 'google-sheets' || source.sourceKind === 'http'
}

export interface DataSourceRow {
  /** Position in the table, 1-based. What a "5-12" range refers to. */
  ordinal: number
  values: Record<string, string>
}

export interface RowPage {
  rows: DataSourceRow[]
  page: number
  pageSize: number
  total: number
}

/** Rows one data source may hold; mirrors the server's ceiling. */
export const MAX_ROWS = 10_000

const KEY = ['data-sources']
/**
 * Includes the page *size*.
 *
 * Leaving it out meant two requests for the same page at different sizes shared
 * one cache entry, and whichever landed first decided what everybody saw. The
 * print dialog fetched a single row to read the table's total, so the row
 * selector opened showing one row of ten.
 */
/**
 * Every input that changes the answer, in the key.
 *
 * `order` belongs here for the same reason `page` does: leaving it out makes
 * ascending and descending share one cache entry, and the list would show the
 * other direction's rows while claiming to show this one. That has happened in
 * this codebase before, with a key that was one field short.
 */
const rowsKey = (
  id: string,
  page: number,
  pageSize: number,
  order: 'asc' | 'desc',
): unknown[] => ['data-source-rows', id, page, pageSize, order]

export function useDataSources() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ dataSources: DataSource[] }>('/data-sources'),
    select: (data) => data.dataSources,
    refetchInterval: false,
  })
}

export function useDataSourceRows(
  id: string | null,
  page: number,
  pageSize = 10,
  /** Viewing order only; printing is always by ascending ordinal. */
  order: 'asc' | 'desc' = 'asc',
) {
  return useQuery({
    queryKey: rowsKey(id ?? '', page, pageSize, order),
    queryFn: () =>
      request<RowPage>(`/data-sources/${id}/rows?page=${page}&pageSize=${pageSize}&order=${order}`),
    enabled: id !== null,
    refetchInterval: false,
  })
}

/**
 * Upload, as multipart.
 *
 * A raw `fetch` rather than the JSON client: the body is a file, and the
 * browser has to set the boundary itself.
 */
export interface UploadInput {
  file: File
  name?: string
  encoding?: string
  delimiter?: string
  /** Replace this source rather than creating a new one. */
  replaceId?: string
  confirm?: boolean
}

async function uploadCsv(input: UploadInput): Promise<DataSource> {
  const body = new FormData()
  body.append('file', input.file)
  if (input.name !== undefined) body.append('name', input.name)
  if (input.encoding !== undefined) body.append('encoding', input.encoding)
  if (input.delimiter !== undefined) body.append('delimiter', input.delimiter)

  const url =
    input.replaceId === undefined
      ? '/api/data-sources'
      : `/api/data-sources/${input.replaceId}/replace${input.confirm === true ? '?confirm=true' : ''}`

  const response = await fetch(url, { method: 'POST', body })
  const payload: unknown = await response.json()
  if (!response.ok) {
    throw payload
  }
  return payload as DataSource
}

export function useUploadDataSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: uploadCsv,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: KEY })
      void client.invalidateQueries({ queryKey: ['data-source-rows'] })
    },
  })
}

export function useRenameDataSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      request<DataSource>(`/data-sources/${input.id}`, { method: 'PATCH', body: { name: input.name } }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function usePatchRows() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      upserts?: Array<{ ordinal: number; values: Record<string, string> }>
      deletes?: number[]
    }) =>
      request<DataSource>(`/data-sources/${input.id}/rows`, {
        method: 'PATCH',
        body: { upserts: input.upserts ?? [], deletes: input.deletes ?? [] },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: KEY })
      void client.invalidateQueries({ queryKey: ['data-source-rows'] })
    },
  })
}

export function useDeleteDataSource() {
  const client = useQueryClient()
  return useMutation({
    // `confirm` is always sent: the dialog has already asked. The flag exists
    // so the endpoint cannot be reached by an idempotent retry.
    mutationFn: (id: string) => request<void>(`/data-sources/${id}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export interface GoogleStatus {
  configured: boolean
  /** The address a spreadsheet must be shared with, when configured. */
  clientEmail: string | null
}

export interface WorksheetList {
  spreadsheetId: string
  spreadsheetTitle: string
  worksheets: Array<{ id: number; title: string }>
}

export interface WorksheetPreview {
  spreadsheetTitle: string
  worksheetTitle: string
  columns: string[]
  sampleRows: Array<Record<string, string>>
  totalRows: number
  suggestedName: string
  nameTaken: boolean
}

const GOOGLE_STATUS_KEY = ['google-status']

export function useGoogleStatus() {
  return useQuery({
    queryKey: GOOGLE_STATUS_KEY,
    queryFn: () => request<GoogleStatus>('/google/status'),
    // Deployment configuration; it does not change while somebody is looking.
    staleTime: Infinity,
  })
}

export function useListWorksheets() {
  return useMutation({
    mutationFn: (url: string) =>
      request<WorksheetList>('/google/worksheets', { method: 'POST', body: { url } }),
  })
}

export function usePreviewWorksheet() {
  return useMutation({
    mutationFn: (input: { spreadsheetId: string; worksheetId: number }) =>
      request<WorksheetPreview>('/google/preview', { method: 'POST', body: input }),
  })
}

export function useCreateLinkedSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { spreadsheetId: string; worksheetId: number; name: string }) =>
      request<DataSource>('/data-sources/google', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export type RefreshOutcome =
  | { outcome: 'applied'; rowsBefore: number; rowsAfter: number; columnsAdded: string[]; lastRefreshedAt: string | null }
  | { outcome: 'needsConfirmation'; removedColumns: string[]; addedColumns: string[]; affectedTemplates: Array<{ id: string; name: string }> }
  | { outcome: 'refusedTooManyRows'; rowCount: number; limit: number }
  | { outcome: 'failed'; reason: string; detail?: string }

export function useRefreshDataSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; confirmColumnChange?: boolean }) =>
      request<RefreshOutcome>(`/data-sources/${input.id}/refresh`, {
        method: 'POST',
        body: input.confirmColumnChange === true ? { confirmColumnChange: true } : {},
      }),
    onSuccess: (result) => {
      // Only a refresh that actually wrote something invalidates anything. The
      // other three outcomes changed nothing, and refetching after them would
      // suggest to the user that it had.
      if (result.outcome === 'applied') {
        void client.invalidateQueries({ queryKey: KEY })
        void client.invalidateQueries({ queryKey: ['data-source-rows'] })
      }
    },
  })
}

export function useUnlinkDataSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request<DataSource>(`/data-sources/${id}/unlink`, { method: 'POST', body: { confirmed: true } }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Connect a table that reads from an address.
 *
 * No rows are fetched here — the server creates it empty and the first refresh
 * fills it — so this returns quickly even when the other end is down, and a
 * producer that is having a bad afternoon does not stop the table being made.
 */
export function useCreateHttpSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      url: string
      keyColumn: string
      headers?: Record<string, string>
      refreshIntervalSeconds?: number
      refreshBeforePrint?: boolean
    }) => request<DataSource>('/data-sources/http', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Change how an existing one reads.
 *
 * `headers` left out means "leave the credential alone" — it cannot be read
 * back, so requiring it to be resent would be requiring it to be known.
 */
export function usePatchHttpSource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: {
      id: string
      url?: string
      keyColumn?: string
      headers?: Record<string, string>
      refreshIntervalSeconds?: number
      refreshBeforePrint?: boolean
    }) => request<DataSource>(`/data-sources/${id}/http`, { method: 'PATCH', body: patch }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Header lines as a person types them, one `Name: value` per line.
 *
 * Split on the **first** colon only: a bearer token or a URL in a header value
 * contains colons of its own, and splitting on all of them would quietly
 * truncate the credential — which fails later, as a 401 nobody can explain.
 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    const at = trimmed.indexOf(':')
    if (at <= 0) {
      continue
    }
    headers[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim()
  }
  return headers
}
