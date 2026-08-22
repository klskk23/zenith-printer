import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'

export interface SequencePool {
  id: string
  name: string
  digits: number
  step: number
  /** Where numbering was last restarted. Shown so a reset can say "from what". */
  floor: number
  /** Derived from what was printed, never stored. */
  current: number
  nextValue: number
}

const KEY = ['sequence-pools']

export function useSequencePools() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ pools: SequencePool[] }>('/sequence-pools'),
    select: (data) => data.pools,
    refetchInterval: false,
  })
}

export function useCreatePool() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; digits: number; step: number }) =>
      request<SequencePool>('/sequence-pools', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdatePool() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; body: { name: string; digits: number; step: number } }) =>
      request<SequencePool>(`/sequence-pools/${input.id}`, { method: 'PATCH', body: input.body }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Restart numbering.
 *
 * `confirm` is always sent true from here, because the UI has already asked —
 * the flag exists so the endpoint cannot be reached by an idempotent retry.
 */
export function useResetPool() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; floor: number }) =>
      request<SequencePool>(`/sequence-pools/${input.id}/reset`, {
        method: 'POST',
        body: { floor: input.floor, confirm: true },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletePool() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/sequence-pools/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
