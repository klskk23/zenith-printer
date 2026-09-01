/**
 * Print presets, over the API.
 *
 * A preset holds no data of its own — four references and a count — so there
 * is no optimistic anything here and no cache to keep warm. Create, list,
 * edit, delete.
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
    /**
     * `presets`, matching the envelope the ledger reads.
     *
     * That envelope is part of the contract with whatever fills a dropdown
     * from it, so this side follows the server rather than the other way
     * around. It read `printPresets` for a while after the server stopped
     * sending it, and the page simply had nothing on it — no error, no empty
     * state, because `undefined` is neither.
     */
    queryFn: () => request<{ presets: PrintPreset[] }>('/print-presets'),
    select: (data) => data.presets,
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

/**
 * Change one, keeping its id.
 *
 * The id is the whole point of a preset: it lives in somebody else's
 * configuration, and every one of the four decisions behind it can be revised
 * here without that side being told, let alone redeployed. Deleting and
 * recreating would hand them a new id, which is the thing a preset exists to
 * avoid.
 */
export function useUpdatePrintPreset() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      changes: {
        name?: string
        templateId?: string
        printerId?: string
        profileId?: string | null
        copies?: number
      }
    }) => request<PrintPreset>(`/print-presets/${input.id}`, { method: 'PATCH', body: input.changes }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
