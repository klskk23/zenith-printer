/**
 * What the labels page says about the machines, decided without rendering.
 *
 * There is no live "online" lamp. Reaching a printer means opening its serial
 * port or socket, and doing that on a timer would hold the link the print
 * queue needs. What is summarised instead is what the service knows without
 * touching the device: whether it has been probed, what its queue is doing,
 * and — the one that matters most — whether the model can report its stock.
 * A model that cannot is *told about*, never left blank: blank looks like "no
 * data yet", and it means "this printer stops mid-batch without warning".
 */
import type { JobStatus, Printer, QueueState } from '../api/types.ts'
import type { PrintJob } from '../features/jobs/hooks.ts'
import { consumableDisplay, type ConsumableDisplay } from '../pages/consumable.ts'

export interface PrinterStatus {
  id: string
  name: string
  probed: boolean
  queueState: QueueState
  /** Jobs queued or printing on this printer. */
  pending: number
  consumable: ConsumableDisplay
}

export interface StatusSummary {
  printers: PrinterStatus[]
  /** null when there are no printers — there is no queue to speak of. */
  queue: { state: QueueState; pending: number } | null
  /** The most recently *finished* job, by finish time; null when none has. */
  lastPrint: { jobId: string; labelName: string | null; status: JobStatus } | null
}

const isPending = (job: PrintJob): boolean => job.status === 'queued' || job.status === 'printing'

export function summarize(
  printers: readonly Printer[] | undefined,
  jobs: readonly PrintJob[] | undefined,
): StatusSummary {
  const list = printers ?? []
  const all = jobs ?? []

  const pendingByPrinter = new Map<string, number>()
  for (const job of all) {
    if (isPending(job) && job.printerId !== null) {
      pendingByPrinter.set(job.printerId, (pendingByPrinter.get(job.printerId) ?? 0) + 1)
    }
  }

  const status: PrinterStatus[] = list.map((printer) => ({
    id: printer.id,
    name: printer.name,
    probed: printer.capabilities !== null,
    queueState: printer.queueState,
    pending: pendingByPrinter.get(printer.id) ?? 0,
    consumable: consumableDisplay(printer),
  }))

  const queue =
    list.length === 0
      ? null
      : {
          // Paused anywhere is worth saying at the top: a paused printer is
          // one whose jobs are silently piling up.
          state: list.some((printer) => printer.queueState === 'paused') ? ('paused' as const) : ('running' as const),
          pending: all.filter(isPending).length,
        }

  let last: PrintJob | null = null
  for (const job of all) {
    if (job.finishedAt !== null && (last === null || job.finishedAt > last.finishedAt!)) {
      last = job
    }
  }
  const lastPrint =
    last === null ? null : { jobId: last.id, labelName: last.snapshot.templateName, status: last.status }

  return { printers: status, queue, lastPrint }
}
