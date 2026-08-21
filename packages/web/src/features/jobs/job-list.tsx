/**
 * Job queue view.
 *
 * The one thing this must get right is the difference between "printed 0" and
 * "we do not know how many printed". They look alike on screen and mean
 * completely different things: the second requires somebody to walk over and
 * count the labels before reprinting (FR-053).
 */
import { ApiRequestError } from '../../api/client.ts'
import type { JobStatus } from '../../api/types.ts'
import { useState } from 'react'
import { copy } from '../../i18n/index.ts'
import { usePreferences } from '../preferences/context.tsx'
import { usePrinters } from '../printers/hooks.ts'
import { belongsInQueue, formatInstant, hasTemplate, jobInstant } from './job-summary.ts'
import { ReprintDialog } from './reprint-dialog.tsx'
import { Progress } from '../../components/ui/progress.tsx'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent } from '../../components/ui/card.tsx'
import { cn } from '../../lib/utils.ts'
import { useCancelJob, useJobs, type PrintJob } from './hooks.ts'

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'text-muted-foreground',
  printing: 'text-blue-600 font-medium',
  completed: 'text-emerald-600',
  failed: 'text-destructive font-medium',
  cancelled: 'text-muted-foreground line-through',
}

function ProgressLabel({ job }: { job: PrintJob }): React.JSX.Element {
  const unknown = job.pagesPrinted === null

  return (
    <div className="w-full space-y-1">
      {/*
        `value={null}` is deliberate and is not the same as zero. After a
        service restart the printed count is genuinely unknown; a bar at zero
        would tell someone to reprint the whole batch. Radix renders null as
        indeterminate, and the striped fill says "unknown" rather than "none".
      */}
      <Progress
        value={unknown ? null : Math.round((job.pagesPrinted! / Math.max(1, job.requestedCopies)) * 100)}
      />
      {unknown ? (
        <span className="font-medium text-amber-700">
          {copy.jobs.progressUnknown(job.requestedCopies)}
        </span>
      ) : (
        <span>{copy.jobs.progress(job.pagesPrinted!, job.requestedCopies)}</span>
      )}
    </div>
  )
}

function JobRow({ job }: { job: PrintJob }): React.JSX.Element {
  const { preferences } = usePreferences()
  const locale = preferences.language
  const cancel = useCancelJob()
  const [reprinting, setReprinting] = useState(false)
  const cancellable = job.status === 'queued'

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              What was printed, not which row this is. An id fragment identifies
              a job to someone reading logs; it tells the person holding the
              labels nothing.
            */}
            <p className="truncate text-sm font-medium">
              {hasTemplate(job) ? job.snapshot.templateName : copy.jobs.adHoc}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatInstant(jobInstant(job), locale)} · {copy.jobs.copies(job.requestedCopies)}
            </p>
          </div>
          <span className={cn('shrink-0 text-sm', STATUS_STYLE[job.status])}>
            {copy.jobs.status[job.status]}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs">
          <ProgressLabel job={job} />
          {cancellable && (
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              {copy.jobs.cancel}
            </Button>
          )}
        </div>

        {job.status === 'failed' && (
          <>
            <Button size="sm" variant="outline" onClick={() => setReprinting(true)}>
              {copy.jobs.reprint.action}
            </Button>
            <ReprintDialog
              job={job}
              open={reprinting}
              onOpenChange={setReprinting}
              onDone={() => undefined}
            />
          </>
        )}

        {job.status === 'failed' && job.failureCode !== null && (
          <Alert variant={job.failureCode === 'PRINTER_UNREACHABLE' ? 'warning' : 'destructive'} className="text-xs">
            {job.failureCode === 'JOB_INTERRUPTED_BY_RESTART' ? copy.jobs.countManually : job.failureCode}
          </Alert>
        )}

        {cancel.error instanceof ApiRequestError && (
          <Alert variant="destructive" className="text-xs">
            {cancel.error.body.what}
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

export function JobList({ printerId }: { printerId: string | null }): React.JSX.Element {
  const jobs = useJobs(printerId)

  const printers = usePrinters()
  const pausedPrinterIds = new Set(
    (printers.data ?? []).filter((p) => p.queueState === 'paused').map((p) => p.id),
  )

  // What is in flight, plus what is blocking it. Finished jobs used to pile up
  // here as well as in history, so the queue never emptied and the two pages
  // showed the same rows.
  const active = (jobs.data ?? []).filter((job) => belongsInQueue(job, pausedPrinterIds))

  return (
    <div className="space-y-2">
      {active.length === 0 && <p className="text-xs text-muted-foreground">{copy.jobs.empty}</p>}
      <div className="space-y-2">
        {active.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}
