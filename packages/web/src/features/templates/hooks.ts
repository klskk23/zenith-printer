import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LabelElement, VariableDefinition } from '@zenith/shared'
import { request } from '../../api/client.ts'
import type { PrinterKind } from '../../api/types.ts'

export interface Template {
  id: string
  name: string
  printerKind: PrinterKind
  widthMm: number
  heightMm: number
  dpi: number
  elements: LabelElement[]
  variables: VariableDefinition[]
  /** The one data source this design draws rows from, or null. */
  dataSourceId: string | null
  /**
   * Why this design cannot resolve its references right now, computed on read.
   *
   * Never stored: a stored copy drifts from the data source, and it drifts in
   * the direction of "looks fine, is actually broken" (FR-028a).
   */
  bindingIssue: BindingIssue | null
  createdAt: string
  /** Optimistic concurrency token; a save carries the value it loaded with. */
  updatedAt: string
  /** Optimistic concurrency token; a stale value means somebody saved first. */
  version: number
}

export type BindingIssue =
  | { kind: 'sourceMissing' }
  | { kind: 'columnsMissing'; columns: string[] }

const KEY = ['templates']

export function useTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ templates: Template[] }>('/templates'),
    select: (data) => data.templates,
    refetchInterval: false,
  })
}

export function useSaveTemplate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id?: string; version?: number; body: Record<string, unknown> }) =>
      input.id === undefined
        ? request<Template>('/templates', { method: 'POST', body: input.body })
        : request<Template>(`/templates/${input.id}`, {
            method: 'PUT',
            body: { ...input.body, version: input.version },
          }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTemplate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

// There is no print-form hook any more. Nothing is typed in before printing:
// constants are fixed in the design, serials come from a pool, and column
// values come from the rows that were selected.
