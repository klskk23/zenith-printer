/**
 * Reprinting a failed job.
 *
 * The count is asked for rather than assumed. A job that failed after 60 of 100
 * needs 40; one interrupted by a restart needs however many the operator counts
 * on the bench, because the number printed at the moment of a crash is
 * genuinely unknowable. Defaulting to the original count would reprint labels
 * that are already on the roll.
 */
import { useState } from 'react'
import { ApiRequestError, request } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import type { PrintJob } from './hooks.ts'

export interface ReprintDialogProps {
  job: PrintJob
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

/** What is left to print, when that is knowable. */
function shortfall(job: PrintJob): number | null {
  if (job.pagesPrinted === null) {
    return null
  }
  return Math.max(1, job.requestedCopies - job.pagesPrinted)
}

export function ReprintDialog({ job, open, onOpenChange, onDone }: ReprintDialogProps): React.JSX.Element {
  const suggested = shortfall(job)
  const [copies, setCopies] = useState(suggested ?? 1)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await request(`/print-jobs/${job.id}/reprint`, { method: 'POST', body: { copies } })
      onOpenChange(false)
      onDone()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.jobs.reprint.heading}</DialogTitle>
          <DialogDescription>
            {suggested === null
              ? // The count is unknowable, so the operator supplies it.
                copy.jobs.reprint.unknownCount
              : copy.jobs.reprint.knownCount(job.pagesPrinted!, job.requestedCopies)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label>{copy.print.copies}</Label>
          <Input
            autoFocus
            type="number"
            min={1}
            max={100}
            value={copies}
            onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>

        {error !== null && (
          <Alert variant="destructive" className="text-xs">
            <p className="font-medium">{error.body.what}</p>
            <p className="mt-1 opacity-90">{error.body.why}</p>
            <p className="mt-1 font-medium">{error.body.next}</p>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          {/* Printing consumes stock; the wording says so before the click. */}
          <Button disabled={busy} onClick={() => void submit()}>
            {copy.jobs.reprint.confirm(copies)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
