/**
 * Overview.
 *
 * Deliberately not a second copy of the list pages: it shows enough to decide
 * where to go, then hands off. Recent templates cap at six and link to the
 * library rather than growing into it.
 *
 * There is no live "online" lamp. Reaching a printer means opening its serial
 * port or socket, and doing that on a timer would hold the link the print queue
 * needs — a status light that interferes with printing is a bad trade. What is
 * shown instead is what the service knows without touching the device: whether
 * it has ever been probed, and what its queue is doing.
 */
import { useMemo, useState } from 'react'
import { copy } from '../i18n/index.ts'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { usePrinters } from '../features/printers/hooks.ts'
import { useJobs, type PrintJob } from '../features/jobs/hooks.ts'
import { useTemplates, type Template } from '../features/templates/hooks.ts'
import { useWorkspace } from '../app/workspace.tsx'
import { ReprintDialog } from '../features/jobs/reprint-dialog.tsx'
import { PausedQueueBanner } from '../features/jobs/paused-banner.tsx'
import type { Printer } from '../api/types.ts'
import { consumableDisplay } from './consumable.ts'
import { ThumbnailFrame } from '../features/templates/thumbnail-frame.tsx'

const RECENT_TEMPLATES = 6
const RECENT_JOBS = 5

function PrinterCard({ printer, pending }: { printer: Printer; pending: number }): React.JSX.Element {
  const { open } = useWorkspace()
  const consumable = consumableDisplay(printer)

  return (
    <Card>
      <CardHeader className="pb-2">
        <Button
          variant="ghost"
          size="row-inline"
          className="text-sm hover:bg-transparent hover:underline"
          onClick={() => open({ kind: 'printers' })}
        >
          <CardTitle>{printer.name}</CardTitle>
        </Button>
        <p className="font-mono text-[11px] text-muted-foreground">
          {printer.kind} · {printer.address}
        </p>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          {printer.queueState === 'running' ? copy.index.queueRunning : copy.index.queuePaused}
          {pending > 0 ? ` · ${copy.index.pendingJobs(pending)}` : ''}
        </p>
        {/*
          FR-026: the two families genuinely differ here, and the difference is
          the user's to know — a model that cannot count its stock just stops
          mid-batch with no warning beforehand.
        */}
        <p className="text-muted-foreground">
          {consumable.kind === 'not-probed'
            ? copy.printers.notProbed
            : consumable.kind === 'supported'
              ? copy.printers.capabilities.supported
              : copy.index.remainingUnsupported}
        </p>
      </CardContent>
    </Card>
  )
}

function TemplateCard({ template }: { template: Template }): React.JSX.Element {
  const { open } = useWorkspace()
  return (
    <Button
      variant="outline"
      size="row"
      // Two stacked lines rather than one, so the row's `items-center` and
      // horizontal flow are turned off here.
      className="flex-col items-start gap-0.5 px-3 py-2"
      onClick={() => open({ kind: 'design', templateId: template.id })}
    >
      <span className="block w-full truncate font-medium">{template.name}</span>
      <span className="block text-muted-foreground">
        {template.widthMm} × {template.heightMm} mm
      </span>
      {/* The same frame the library uses, so the two lists show a design the
          same way rather than drifting apart at the first adjustment. */}
      <ThumbnailFrame template={template} maxWidthPx={190} maxHeightPx={110} className="mt-1.5" />
    </Button>
  )
}

function JobRow({ job }: { job: PrintJob }): React.JSX.Element {
  const [reprinting, setReprinting] = useState(false)
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="truncate">
        {job.snapshot.templateName ?? copy.workspace.untitledDesign} · {job.requestedCopies}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground">{copy.jobs.status[job.status]}</span>
        {job.status === 'failed' && (
          <>
            {/* Reprinting is deliberate and needs a count, so it opens the same
                dialog as everywhere else rather than resubmitting blindly. */}
            <Button size="sm" variant="ghost" onClick={() => setReprinting(true)}>
              {copy.index.resubmit}
            </Button>
            <ReprintDialog
              job={job}
              open={reprinting}
              onOpenChange={setReprinting}
              onDone={() => undefined}
            />
          </>
        )}
      </span>
    </li>
  )
}

export function IndexPage(): React.JSX.Element {
  const { open } = useWorkspace()
  const printers = usePrinters()
  const templates = useTemplates()
  const jobs = useJobs(null)

  const pendingByPrinter = useMemo(() => {
    const counts = new Map<string, number>()
    for (const job of jobs.data ?? []) {
      if ((job.status === 'queued' || job.status === 'printing') && job.printerId !== null) {
        counts.set(job.printerId, (counts.get(job.printerId) ?? 0) + 1)
      }
    }
    return counts
  }, [jobs.data])

  const recentTemplates = (templates.data ?? []).slice(0, RECENT_TEMPLATES)
  const recentJobs = (jobs.data ?? []).slice(0, RECENT_JOBS)

  return (
    <div className="space-y-6">
      {/* A paused queue is the first thing worth knowing on this page. */}
      <PausedQueueBanner />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.index.printerSection}</h2>
          <Button size="sm" variant="ghost" onClick={() => open({ kind: 'printers' })}>
            {copy.index.managePrinters}
          </Button>
        </div>
        {printers.data?.length === 0 ? (
          <Alert>{copy.index.noPrinters}</Alert>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {printers.data?.map((printer) => (
              <PrinterCard key={printer.id} printer={printer} pending={pendingByPrinter.get(printer.id) ?? 0} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.index.templateSection}</h2>
          <Button size="sm" variant="ghost" onClick={() => open({ kind: 'templates' })}>
            {copy.index.allTemplates}
          </Button>
        </div>
        {/*
          Same rule as the library: as many cards as fit, never below the
          floor. A lower floor here because this list sits inside a column of
          other sections rather than filling the page.
        */}
        {recentTemplates.length === 0 ? (
          <Alert>{copy.index.noTemplates}</Alert>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
            {recentTemplates.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.index.recentJobsSection}</h2>
          <Button size="sm" variant="ghost" onClick={() => open({ kind: 'history' })}>
            {copy.index.allHistory}
          </Button>
        </div>
        {recentJobs.length === 0 ? (
          <Alert>{copy.index.noRecentJobs}</Alert>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border px-3">
            {recentJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
