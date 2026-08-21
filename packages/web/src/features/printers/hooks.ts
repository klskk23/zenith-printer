import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'
import type { Printer, QueueState } from '../../api/types.ts'

const KEY = ['printers']

export function usePrinters() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<{ printers: Printer[] }>('/printers'),
    select: (data) => data.printers,
  })
}

export function useAddPrinter() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<Printer>('/printers', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useProbePrinter() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<Printer>(`/printers/${id}/probe`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSetQueueState() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; queueState: QueueState }) =>
      request<Printer>(`/printers/${input.id}/queue`, {
        method: 'PATCH',
        body: { queueState: input.queueState },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletePrinter() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/printers/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
