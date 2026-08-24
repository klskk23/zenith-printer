/**
 * Reprinting a job.
 *
 * The count is asked for rather than assumed. A job that failed after 60 of 100
 * needs 40; one interrupted by a restart needs however many the operator counts
 * on the bench, because the number printed at the moment of a crash is
 * genuinely unknowable. Defaulting to the original count would reprint labels
 * that are already on the roll.
 *
 * The printer and the settings are asked for too, and both default to the
 * original — a plain "print that again" has to keep meaning exactly that. The
 * reason to change either is the other half of why people reprint: that machine
 * jammed, or those came out too light.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx'
import { usePrinters } from '../printers/hooks.ts'
import { useProfiles } from '../profiles/hooks.ts'
import type { PrintJob } from './hooks.ts'

export interface ReprintDialogProps {
  job: PrintJob
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

/**
 * How many to offer, and why.
 *
 *   - A job that finished wants the whole batch again. Its shortfall is zero,
 *     and the failure-shaped default would offer one label where there were a
 *     hundred.
 *   - A job that failed part-way wants the difference: 60 of 100 printed leaves
 *     40, and defaulting to 100 reprints labels already on the roll.
 *   - A job interrupted by a restart has no knowable count at all; the operator
 *     counts what came out and says so.
 */
function suggestedCount(job: PrintJob): number | null {
  if (job.status === 'completed') {
    return job.requestedCopies
  }
  if (job.pagesPrinted === null) {
    return null
  }
  return Math.max(1, job.requestedCopies - job.pagesPrinted)
}

export function ReprintDialog({ job, open, onOpenChange, onDone }: ReprintDialogProps): React.JSX.Element {
  const suggested = suggestedCount(job)
  const [copies, setCopies] = useState(suggested ?? 1)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [busy, setBusy] = useState(false)

  // Null means "as it was". Kept distinct from the original's id so that the
  // request carries nothing at all when nothing was chosen — the server then
  // reuses the original, which is what a reprint means by default.
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)

  // Every probed printer, of either kind. Both drivers are handed a bitmap, so
  // a design has no kind of its own to clash with; filtering by kind would hide
  // a machine that prints the label perfectly well. Unprobed ones are left out
  // because nothing knows their head width until they have answered.
  const printers = (usePrinters().data ?? []).filter((printer) => printer.capabilities !== null)
  const chosenPrinter = printerId ?? job.printerId
  const profiles = useProfiles(chosenPrinter).data ?? []

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await request(`/print-jobs/${job.id}/reprint`, {
        method: 'POST',
        body: {
          copies,
          ...(printerId === null ? {} : { printerId }),
          ...(profileId === null ? {} : { profileId }),
        },
      })
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
            {job.status === 'completed'
              ? copy.jobs.reprint.completedCount(job.requestedCopies)
              : suggested === null
                ? // The count is unknowable, so the operator supplies it.
                  copy.jobs.reprint.unknownCount
                : copy.jobs.reprint.knownCount(job.pagesPrinted!, job.requestedCopies)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="reprint-printer">{copy.jobs.reprint.printer}</Label>
          <Select
            value={chosenPrinter ?? undefined}
            onValueChange={(value) => {
              setPrinterId(value)
              // Settings belong to a printer — density and label type mean
              // something only against a particular head, and the server
              // refuses a mismatch. Carrying the old choice across would turn
              // a printer change into an error message.
              setProfileId(null)
            }}
          >
            <SelectTrigger id="reprint-printer" aria-label={copy.jobs.reprint.printer}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printers.map((printer) => (
                <SelectItem key={printer.id} value={printer.id}>
                  {printer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="reprint-profile">{copy.jobs.reprint.profile}</Label>
          <Select
            value={profileId ?? ''}
            disabled={profiles.length === 0}
            onValueChange={(value) => setProfileId(value)}
          >
            <SelectTrigger id="reprint-profile" aria-label={copy.jobs.reprint.profile}>
              <SelectValue
                placeholder={
                  profiles.length === 0
                    ? copy.jobs.reprint.noProfiles
                    : copy.jobs.reprint.profileDefault
                }
              />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
