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
import { copy } from '../../i18n/index.ts'
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
  const cancel = useCancelJob()
  const cancellable = job.status === 'queued'

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className={cn('text-sm', STATUS_STYLE[job.status])}>{copy.jobs.status[job.status]}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{job.id.slice(0, 8)}</span>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs">
          <ProgressLabel job={job} />
          {cancellable && (
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              {copy.jobs.cancel}
            </Button>
          )}
        </div>

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

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{copy.jobs.heading}</h3>
      {jobs.data?.length === 0 && <p className="text-xs text-muted-foreground">{copy.jobs.empty}</p>}
      <div className="space-y-2">
        {jobs.data?.map((job) => <JobRow key={job.id} job={job} />)}
      </div>
    </div>
  )
}
