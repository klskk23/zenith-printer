/**
 * Job history.
 *
 * The record of what was actually printed, which is why it reads from the
 * snapshot rather than from the template: a design edited or deleted after the
 * fact must not change what this says (FR-050, FR-051).
 *
 * It also carries the one number people come here for — how many copies really
 * came out — including the case where that number is unknown.
 */
import { useState } from 'react'
import { copy } from '../../i18n/index.ts'
import { usePreferences } from '../preferences/context.tsx'
import { formatInstant, hasTemplate, jobInstant } from './job-summary.ts'
import { Button } from '../../components/ui/button.tsx'
import { ReprintDialog } from './reprint-dialog.tsx'
import { Alert } from '../../components/ui/alert.tsx'
import { Card, CardContent } from '../../components/ui/card.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx'
import { useHistoryPrune, useJobHistory, type PrintJob } from './hooks.ts'

/**
 * How many rows a visit fetches.
 *
 * The list used to arrive whole and get sliced here, which meant carrying every
 * job snapshot ever recorded — each one a full label IR — to draw five rows.
 */
const PAGE_SIZE = 10

/** Offered retention. Ten is a page; keeping ten would be closer to wiping it. */
const KEEP_OPTIONS = [50, 100, 200] as const

/** Jobs that are over, one way or another — the ones there is a point reprinting. */
const FINISHED: ReadonlySet<PrintJob['status']> = new Set(['completed', 'failed', 'cancelled'])

function HistoryRow({ job }: { job: PrintJob }): React.JSX.Element {
  const { preferences } = usePreferences()
  const unknown = job.pagesPrinted === null

  return (
    <Card data-history-row={job.id}>
      <CardContent className="space-y-1 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          {/* Stated, not blank: "no template" is a fact about this job, and a
              blank where a name goes reads as missing data instead. */}
          <span className={hasTemplate(job) ? 'font-medium' : 'font-medium text-muted-foreground'}>
            {hasTemplate(job) ? job.snapshot.templateName : copy.jobs.adHoc}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">{copy.jobs.status[job.status]}</span>
            {FINISHED.has(job.status) && (
              // Offered on anything that finished, not only on failures. The
              // action grew out of "count the labels and reprint the
              // shortfall", but the commoner reason is duller: the same batch
              // is wanted again next week.
              <ReprintEntry job={job} />
            )}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          {/* Follows the interface language; this used to be hardcoded zh-CN,
              so an English interface still showed Chinese timestamps. */}
          <span>{formatInstant(jobInstant(job), preferences.language)}</span>
          <span className={unknown ? 'font-medium text-warning' : ''}>
            {unknown
              ? copy.jobs.progressUnknown(job.requestedCopies)
              : copy.jobs.progress(job.pagesPrinted ?? 0, job.requestedCopies)}
          </span>
        </div>

        <p className="font-mono text-2xs text-muted-foreground">
          {job.snapshot.widthMm}×{job.snapshot.heightMm}mm · {job.id.slice(0, 8)}
          {(job.overflowWarnings?.length ?? 0) > 0 && (
            // Recorded at submission, because the design may have changed since.
            <span className="ml-2 text-warning">
              {copy.overflow.inHistory} ({job.overflowWarnings!.length})
            </span>
          )}
        </p>

        {unknown && <Alert variant="warning" className="text-2xs">{copy.jobs.countManually}</Alert>}
      </CardContent>
    </Card>
  )
}

export function JobHistory({ printerId }: { printerId: string | null }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const history = useJobHistory(printerId, expanded ? null : PAGE_SIZE)

  /**
   * How many there are, which is not how many are in hand.
   *
   * Read from the server so that "show all 372" can say 372 while holding ten.
   * Counting the rows would have made the offer describe itself.
   */
  const total = history.data?.total ?? 0
  // Newest first: history is read backwards from what just happened. The
  // endpoint returns oldest-first, as it always has.
  const shown = [...(history.data?.jobs ?? [])].reverse()

  return (
    <div className="space-y-2">
      {/* The page supplies the heading; a second one here read as a repeat. */}
      <div className="flex items-center justify-end gap-1">
        {total > PAGE_SIZE && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? copy.history.collapse : copy.history.expand(total)}
          </Button>
        )}
        {total > 0 && <HistoryPrune total={total} />}
      </div>

      {total === 0 && <p className="text-xs text-muted-foreground">{copy.history.empty}</p>}

      <div className="space-y-2">
        {shown.map((job) => (
          <HistoryRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}

/**
 * Throwing away all but the most recent N.
 *
 * Confirmed, because it deletes records for everyone and there is no undo
 * (III.0). No plan-then-delete round trip: the list already knows the total, so
 * the dialog can state the consequence exactly before anything is sent.
 *
 * It says out loud that the serial numbers survive. That is the fear this
 * action ought to provoke — a counter derived from history, and history being
 * deleted — and the answer is a schema decision (migration 15) that no operator
 * could be expected to know about.
 */
function HistoryPrune({ total }: { total: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState<number>(100)
  const prune = useHistoryPrune()

  const deleted = Math.max(0, total - keep)

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {copy.history.prune}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-history-prune>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.history.pruneTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.history.pruneIrreversible}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-center gap-2 text-xs">
            <span>{copy.history.pruneKeepLabel}</span>
            <Select value={String(keep)} onValueChange={(value) => setKeep(Number(value))}>
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEEP_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>{copy.history.pruneKeepUnit}</span>
          </div>

          <p className="text-xs">
            {deleted === 0 ? copy.history.pruneNothing : copy.history.pruneEffect(deleted, total - deleted)}
          </p>
          <p className="text-2xs text-muted-foreground">{copy.history.pruneSequencesKept}</p>

          <AlertDialogFooter>
            <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={prune.isPending || deleted === 0}
              onClick={() => prune.mutate(keep, { onSuccess: () => setOpen(false) })}
            >
              {prune.isPending ? copy.history.pruneRunning : copy.history.pruneAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** The reprint action plus its dialog, kept together so each row owns its state. */
function ReprintEntry({ job }: { job: PrintJob }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {/* Two different words for two different things: a shortfall is made
            up, a finished batch is run again. */}
        {job.status === 'completed' ? copy.jobs.reprint.againAction : copy.jobs.reprint.action}
      </Button>
      <ReprintDialog job={job} open={open} onOpenChange={setOpen} onDone={() => undefined} />
    </>
  )
}
