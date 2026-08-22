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
  sourceKind: 'local' | 'google-sheets'
  /** Present only when linked. Flattened onto the same object by the server. */
  spreadsheetId?: string
  spreadsheetTitle?: string
  worksheetId?: number
  worksheetTitle?: string
  lastRefreshedAt?: string
  createdAt: string
  updatedAt: string
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
const rowsKey = (id: string, page: number, pageSize: number): unknown[] => [
  'data-source-rows',
  id,
  page,
  pageSize,
]

export function useDataSources() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ dataSources: DataSource[] }>('/data-sources'),
    select: (data) => data.dataSources,
    refetchInterval: false,
  })
}

export function useDataSourceRows(id: string | null, page: number, pageSize = 10) {
  return useQuery({
    queryKey: rowsKey(id ?? '', page, pageSize),
    queryFn: () => request<RowPage>(`/data-sources/${id}/rows?page=${page}&pageSize=${pageSize}`),
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
