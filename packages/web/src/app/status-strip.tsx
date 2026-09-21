/**
 * The status strip at the top of the gallery: the queue, and the last print.
 *
 * The printers themselves live at the foot of the sidebar, where they are
 * visible from every page; what is left here is what the gallery is about —
 * whether things are moving and how the last one went. Renders a summary it
 * is handed (app/status-summary.ts) and decides nothing itself.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Separator } from '../components/ui/separator.tsx'
import type { StatusSummary } from './status-summary.ts'

export function Dot({ live }: { live: boolean }): React.JSX.Element {
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

export interface StatusStripProps {
  summary: StatusSummary
  /**
   * Whether the jobs have not answered yet. "Nothing here" and "nothing here
   * *yet*" are different answers, and an empty list is what an unanswered
   * query looks like — so a section still loading says nothing at all.
   */
  loading?: boolean
}

export function StatusStrip({ summary, loading = false }: StatusStripProps): React.JSX.Element {
  const { queue, lastPrint } = summary
  return (
    <div
      className="flex flex-wrap items-center gap-x-n8 gap-y-n2 border-b border-border px-n8 py-n3 text-xs"
      data-status-strip
    >
      {queue !== null && (
        <>
          <span className="flex items-center gap-n2" data-queue-status>
            <Dot live={queue.state === 'running'} />
            <span className={queue.state === 'paused' ? 'text-warning' : 'text-foreground'}>
              {queue.state === 'running' ? copy.status.queueRunning : copy.status.queuePaused}
            </span>
            <span className="text-muted-foreground">{copy.status.pending(queue.pending)}</span>
          </span>
          <Separator orientation="vertical" className="h-4" />
        </>
      )}

      <span className="text-muted-foreground" data-last-print>
        {loading ? (
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
