import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LabelElement } from '@zenith/shared'
import { request } from '../../api/client.ts'
import type { PrinterKind } from '../../api/types.ts'

export interface VariableField {
  name: string
  label: string
  source: 'manual' | 'sequence'
  sampleValue?: string
  seqStart?: number
  seqDigits?: number
  seqStep?: number
}

export interface Template {
  id: string
  name: string
  printerKind: PrinterKind
  widthMm: number
  heightMm: number
  dpi: number
  elements: LabelElement[]
  variableFields: VariableField[]
  createdAt: string
  /** Optimistic concurrency token; a save carries the value it loaded with. */
  updatedAt: string
  /** Optimistic concurrency token; a stale value means somebody saved first. */
  version: number
}

export interface PrintFormField {
  name: string
  label: string
  source: 'manual' | 'sequence'
  sampleValue?: string
  suggestedStart?: number
  seqDigits?: number
  seqStep?: number
  maxRepresentable?: number
}

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

/** What must be collected before a job can be submitted (FR-038, FR-048). */
export function usePrintForm(templateId: string | null) {
  return useQuery({
    queryKey: ['print-form', templateId],
    queryFn: () => request<{ fields: PrintFormField[] }>(`/templates/${templateId}/print-form`),
    enabled: templateId !== null,
    refetchInterval: false,
  })
}
