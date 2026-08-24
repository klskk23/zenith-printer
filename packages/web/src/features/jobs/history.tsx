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
import { formatInstant, hasTemplate, isFinished, jobInstant } from './job-summary.ts'
import { Button } from '../../components/ui/button.tsx'
import { ReprintDialog } from './reprint-dialog.tsx'
import { Alert } from '../../components/ui/alert.tsx'
import { Card, CardContent } from '../../components/ui/card.tsx'
import { useJobs, type PrintJob } from './hooks.ts'

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
          <span className={unknown ? 'font-medium text-amber-700' : ''}>
            {unknown
              ? copy.jobs.progressUnknown(job.requestedCopies)
              : copy.jobs.progress(job.pagesPrinted ?? 0, job.requestedCopies)}
          </span>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          {job.snapshot.widthMm}×{job.snapshot.heightMm}mm · {job.id.slice(0, 8)}
          {(job.overflowWarnings?.length ?? 0) > 0 && (
            // Recorded at submission, because the design may have changed since.
            <span className="ml-2 text-amber-600">
              {copy.overflow.inHistory} ({job.overflowWarnings!.length})
            </span>
          )}
        </p>

        {unknown && <Alert variant="warning" className="text-[11px]">{copy.jobs.countManually}</Alert>}
      </CardContent>
    </Card>
  )
}

export function JobHistory({ printerId }: { printerId: string | null }): React.JSX.Element {
  const jobs = useJobs(printerId)
  const [expanded, setExpanded] = useState(false)

  // Newest first: history is read backwards from what just happened.
  const finished = (jobs.data ?? []).filter(isFinished).reverse()
  const shown = expanded ? finished : finished.slice(0, 5)

  return (
    <div className="space-y-2">
      {/* The page supplies the heading; a second one here read as a repeat. */}
      {finished.length > 5 && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? copy.history.collapse : copy.history.expand(finished.length)}
          </Button>
        </div>
      )}

      {finished.length === 0 && <p className="text-xs text-muted-foreground">{copy.history.empty}</p>}

      <div className="space-y-2">
        {shown.map((job) => (
          <HistoryRow key={job.id} job={job} />
        ))}
      </div>
    </div>
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
