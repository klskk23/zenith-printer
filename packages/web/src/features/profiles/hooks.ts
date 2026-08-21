import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'

export interface Profile {
  id: string
  printerId: string
  name: string
  density: number
  labelType: number
  speed?: number
  /** Stored in millimetres; the UI steps in dots (FR-029). */
  offsetXMm: number
  offsetYMm: number
  isDefault: boolean
  createdAt: string
}

export function useProfiles(printerId: string | null) {
  return useQuery({
    queryKey: ['profiles', printerId],
    queryFn: () => request<{ profiles: Profile[] }>(`/printers/${printerId}/profiles`),
    select: (data) => data.profiles,
    enabled: printerId !== null,
    refetchInterval: false,
  })
}

export function useSaveProfile(printerId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id === undefined
        ? request<Profile>(`/printers/${printerId}/profiles`, { method: 'POST', body: input.body })
        : request<Profile>(`/profiles/${input.id}`, { method: 'PATCH', body: input.body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['profiles', printerId] }),
  })
}

export function useDeleteProfile(printerId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['profiles', printerId] }),
  })
}
