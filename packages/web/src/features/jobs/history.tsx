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
import { copy } from '../../i18n/zh-CN.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent } from '../../components/ui/card.tsx'
import { useJobs, type PrintJob } from './hooks.ts'

const FINISHED = new Set(['completed', 'failed', 'cancelled'])

function formatWhen(iso: string | null): string {
  if (iso === null) {
    return '—'
  }
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function HistoryRow({ job }: { job: PrintJob }): React.JSX.Element {
  const unknown = job.pagesPrinted === null

  return (
    <Card>
      <CardContent className="space-y-1 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{job.snapshot.templateName ?? copy.history.adHoc}</span>
          <span className="text-muted-foreground">{copy.jobs.status[job.status]}</span>
        </div>

        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>{formatWhen(job.finishedAt ?? job.createdAt)}</span>
          <span className={unknown ? 'font-medium text-amber-700' : ''}>
            {unknown
              ? copy.jobs.progressUnknown(job.requestedCopies)
              : copy.jobs.progress(job.pagesPrinted ?? 0, job.requestedCopies)}
          </span>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          {job.snapshot.widthMm}×{job.snapshot.heightMm}mm · {job.id.slice(0, 8)}
        </p>

        {unknown && <Alert variant="warning" className="text-[11px]">{copy.jobs.countManually}</Alert>}
      </CardContent>
    </Card>
  )
}

export function JobHistory({ printerId }: { printerId: string | null }): React.JSX.Element {
  const jobs = useJobs(printerId)
  const [expanded, setExpanded] = useState(false)

  const finished = (jobs.data ?? []).filter((job) => FINISHED.has(job.status)).reverse()
  const shown = expanded ? finished : finished.slice(0, 5)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{copy.history.heading}</h3>
        {finished.length > 5 && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? copy.history.collapse : copy.history.expand(finished.length)}
          </Button>
        )}
      </div>

      {finished.length === 0 && <p className="text-xs text-muted-foreground">{copy.history.empty}</p>}

      <div className="space-y-2">
        {shown.map((job) => (
          <HistoryRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}
