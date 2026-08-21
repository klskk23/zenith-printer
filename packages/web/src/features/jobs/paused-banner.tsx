/**
 * Why the queue stopped, and how to start it again.
 *
 * A failure pauses the printer's queue on purpose — carrying on after an
 * unknown state would print into a fault. But the reason was recorded and never
 * shown anywhere, and the resume control lived on the printer page, so the
 * queue simply appeared to be broken: jobs sat there, nothing printed, and
 * nothing on screen said why or what to do.
 */
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { usePrinters, useSetQueueState } from '../printers/hooks.ts'

export function PausedQueueBanner(): React.JSX.Element | null {
  const printers = usePrinters()
  const setQueueState = useSetQueueState()

  const paused = (printers.data ?? []).filter((printer) => printer.queueState === 'paused')
  if (paused.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      {paused.map((printer) => (
        <Alert key={printer.id} variant="warning" className="space-y-2 text-xs">
          <p className="font-medium">{copy.jobs.paused.heading(printer.name)}</p>
          {printer.queuePausedReason !== null && (
            // The stored reason is a stable code; the wording for it lives here.
            <p className="opacity-90">
              {copy.jobs.paused.reasons[printer.queuePausedReason] ?? printer.queuePausedReason}
            </p>
          )}
          <p className="opacity-90">{copy.jobs.paused.note}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={setQueueState.isPending}
            onClick={() => setQueueState.mutate({ id: printer.id, queueState: 'running' })}
          >
            {copy.printers.queue.resume}
          </Button>
        </Alert>
      ))}
    </div>
  )
}
