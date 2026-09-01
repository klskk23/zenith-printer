/**
 * Print presets, over the API.
 *
 * A preset holds no data of its own — four references and a count — so there
 * is no optimistic anything here and no cache to keep warm. Create, list,
 * delete.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'

export interface PrintPreset {
  id: string
  name: string
  templateId: string
  printerId: string
  profileId: string | null
  copies: number
  createdAt: string
  updatedAt: string
}

const KEY = ['print-presets']

export function usePrintPresets() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ printPresets: PrintPreset[] }>('/print-presets'),
    select: (data) => data.printPresets,
    refetchInterval: false,
  })
}

export function useCreatePrintPreset() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      templateId: string
      printerId: string
      profileId?: string | null
      copies?: number
    }) => request<PrintPreset>('/print-presets', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletePrintPreset() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/print-presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
