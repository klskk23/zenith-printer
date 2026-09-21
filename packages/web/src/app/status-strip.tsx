/**
 * The status strip at the top of the gallery.
 *
 * One line per fact the service actually knows, in Nocturne's compact scale.
 * It renders a summary it is handed (app/status-summary.ts) and decides
 * nothing itself, so what it says can be tested without it.
 *
 * Built from Badge and Separator rather than a component of its own: shadcn
 * has no "status strip", but it has the parts, and a strip is only those parts
 * in a row.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Separator } from '../components/ui/separator.tsx'
import type { PrinterStatus, StatusSummary } from './status-summary.ts'

function Dot({ live }: { live: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        live ? 'bg-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_22%,transparent)]' : 'bg-neutral-700',
      )}
    />
  )
}

function PrinterLine({ printer }: { printer: PrinterStatus }): React.JSX.Element {
  const stock =
    printer.consumable.kind === 'not-probed'
      ? copy.status.notProbed
      : printer.consumable.kind === 'supported'
        ? copy.status.remainingSupported
        : copy.status.remainingUnsupported
  return (
    <span className="flex items-center gap-n2" data-printer-status={printer.id}>
      <Dot live={printer.probed && printer.queueState === 'running'} />
      <span className="text-foreground">{printer.name}</span>
      <span className="text-muted-foreground">{stock}</span>
      {printer.pending > 0 && <Badge variant="secondary">{copy.status.pending(printer.pending)}</Badge>}
    </span>
  )
}

export interface StatusStripProps {
  summary: StatusSummary
  /**
   * Which halves have not answered yet. "Nothing here" and "nothing here
   * *yet*" are different answers, and an empty list is what an unanswered
   * query looks like — so a section still loading says nothing at all.
   */
  loading?: { printers: boolean; jobs: boolean }
}

export function StatusStrip({ summary, loading = { printers: false, jobs: false } }: StatusStripProps): React.JSX.Element {
  const { printers, queue, lastPrint } = summary
  return (
    <div
      className="flex flex-wrap items-center gap-x-n8 gap-y-n2 border-b border-border px-n8 py-n3 text-xs"
      data-status-strip
    >
      {loading.printers ? (
        <span className="text-muted-foreground" aria-busy>…</span>
      ) : printers.length === 0 ? (
        <span className="text-muted-foreground">{copy.status.noPrinters}</span>
      ) : (
        printers.map((printer) => <PrinterLine key={printer.id} printer={printer} />)
      )}

      {queue !== null && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-n2" data-queue-status>
            <Dot live={queue.state === 'running'} />
            <span className={queue.state === 'paused' ? 'text-warning' : 'text-foreground'}>
              {queue.state === 'running' ? copy.status.queueRunning : copy.status.queuePaused}
            </span>
            <span className="text-muted-foreground">{copy.status.pending(queue.pending)}</span>
          </span>
        </>
      )}

      <Separator orientation="vertical" className="h-4" />
      <span className="text-muted-foreground" data-last-print>
        {loading.jobs ? (
          '…'
        ) : lastPrint === null ? (
          copy.status.noPrints
        ) : (
          <>
            {copy.status.lastPrint}
            <span className="text-foreground">{lastPrint.labelName ?? copy.workspace.untitledDesign}</span>
            {' '}
            <span className={lastPrint.status === 'failed' ? 'text-destructive' : undefined}>
              {copy.jobs.status[lastPrint.status]}
            </span>
          </>
        )}
      </span>
    </div>
  )
}
