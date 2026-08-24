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
  snapshot: {
    templateName: string | null
    widthMm: number
    heightMm: number
    /** Which family of printer ran it — a reprint may only go to the same one. */
    printerKind: 'niimbot' | 'zpl'
  }
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

/**
 * Finished jobs only, newest-relevant first, at most `limit` of them.
 *
 * Separate from `useJobs` because history wants the opposite of what the queue
 * wants. The queue needs everything in flight and would be broken by any cap;
 * history needs a page of what is over and would otherwise haul every job
 * snapshot ever recorded across the network to draw ten rows.
 *
 * `total` comes from the server and ignores the limit — it is what lets the
 * page offer "show all 372" while holding ten.
 *
 * The key still starts with 'jobs', so the invalidation after a cancel or a
 * prune reaches this query too.
 */
export function useJobHistory(printerId: string | null, limit: number | null) {
  const params = new URLSearchParams({ finished: 'true' })
  if (printerId !== null) {
    params.set('printerId', printerId)
  }
  if (limit !== null) {
    params.set('limit', String(limit))
  }
  return useQuery({
    queryKey: ['jobs', printerId, 'history', limit],
    queryFn: () => request<{ jobs: PrintJob[]; total: number }>(`/print-jobs?${params.toString()}`),
    refetchInterval: 2000,
  })
}

/** Throw away all but the most recent `keep` finished jobs. */
export function useHistoryPrune() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (keep: number) =>
      request<{ deleted: number; kept: number }>('/print-jobs/prune', {
        method: 'POST',
        body: { keep },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useCancelJob() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/print-jobs/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  })
}
