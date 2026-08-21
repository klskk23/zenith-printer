import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../../api/client.ts'
import type { JobStatus } from '../../api/types.ts'

export interface PrintJob {
  id: string
  printerId: string | null
  status: JobStatus
  requestedCopies: number
  /** null means unknown after a restart — not zero (FR-053). */
  pagesPrinted: number | null
  failureCode: string | null
  failureMessage: string | null
  snapshot: { templateName: string | null; widthMm: number; heightMm: number }
  /**
   * What was clipped on this run, recorded at submission.
   *
   * Kept on the job rather than recomputed: the design may have changed since,
   * and history has to say what actually happened.
   */
  overflowWarnings?: { rowIndex: number; elementId: string; reason: string }[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export function useJobs(printerId: string | null) {
  return useQuery({
    queryKey: ['jobs', printerId],
    queryFn: () =>
      request<{ jobs: PrintJob[] }>(printerId === null ? '/print-jobs' : `/print-jobs?printerId=${printerId}`),
    select: (data) => data.jobs,
    // Polling, not push: a hundred-copy run takes minutes and two seconds is
    // ample. A long-lived connection would be more machinery than the problem
    // deserves at this scale.
    refetchInterval: 2000,
  })
}

export function useCancelJob() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/print-jobs/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  })
}
