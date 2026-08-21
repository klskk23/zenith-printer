/**
 * Print confirmation.
 *
 * FR-017: printing consumes physical stock and cannot be undone, so it needs a
 * deliberate confirmation and must not be triggerable by a page refresh or a
 * double click. Two mechanisms cover that:
 *
 *   - a modal the user has to act on
 *   - an idempotency key minted once per dialog opening, so a retried request
 *     returns the original job instead of producing a second batch
 */
import { useEffect, useMemo, useState } from 'react'
import type { LabelIR } from '@zenith/shared'
import { ApiRequestError, request } from '../../api/client.ts'
import type { Printer, PrintJobSummary } from '../../api/types.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { OverflowNotice, type OverflowWarning } from './overflow-notice.tsx'
import { Select } from '../../components/ui/select.tsx'
import { usePrintForm } from '../templates/hooks.ts'
import { FieldForm } from './field-form.tsx'

export interface PrintDialogProps {
  ir: LabelIR
  /** When set, the job prints from the saved template rather than this IR. */
  templateId: string | null
  profileId: string | null
  printers: Printer[]
  selectedPrinterId: string | null
  onSelectPrinter: (id: string) => void
  onClose: () => void
}

export function PrintDialog({
  ir,
  templateId,
  profileId,
  printers,
  selectedPrinterId,
  onSelectPrinter,
  onClose,
}: PrintDialogProps): React.JSX.Element {
  const [copies, setCopies] = useState(1)
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [sequenceOverrides, setSequenceOverrides] = useState<Record<string, number>>({})
  const form = usePrintForm(templateId)
  const [submitting, setSubmitting] = useState(false)
  const [warnings, setWarnings] = useState<OverflowWarning[]>([])
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [result, setResult] = useState<PrintJobSummary | null>(null)

  // Minted once per dialog opening. A retry — from a double click, a flaky
  // network, or the browser replaying the request — reuses it and gets the
  // same job back rather than a second stack of labels.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  const printer = printers.find((p) => p.id === selectedPrinterId) ?? null
  const blocked =
    printer === null ? copy.print.selectPrinter : printer.capabilities === null ? copy.print.needsProbe : null

  const jobBody = (): Record<string, unknown> => ({
    printerId: printer?.id,
    // A saved template prints from the stored design; an unsaved one goes as
    // an ad-hoc IR so User Story 1 still works.
    ...(templateId === null ? { ir } : { templateId }),
    ...(profileId === null ? {} : { profileId }),
    copies,
    manualFieldValues: manualValues,
    sequenceOverrides,
  })

  /**
   * Ask what will be clipped before submitting.
   *
   * A barcode bound to a variable field has no fixed width — the module count
   * follows the content — so row 7 of a hundred can overflow while the design
   * looks fine. This is the only place that can be known.
   */
  useEffect(() => {
    if (printer === null || printer.capabilities === null) {
      return
    }
    let cancelled = false
    void request<{ warnings: OverflowWarning[] }>('/print-jobs/preflight', {
      method: 'POST',
      body: jobBody(),
    })
      .then((response) => {
        if (!cancelled) {
          setWarnings(response.warnings)
        }
      })
      // A preflight that fails is not a reason to stop someone printing; the
      // submission itself reports anything that genuinely blocks.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [printer?.id, templateId, profileId, copies, JSON.stringify(manualValues)])

  const submit = async (): Promise<void> => {
    if (printer === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      setResult(
        await request<PrintJobSummary>('/print-jobs', {
          method: 'POST',
          idempotencyKey,
          body: jobBody(),
        }),
      )
    } catch (err) {
      setError(err instanceof ApiRequestError ? err : null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">{copy.print.heading}</h2>

        {result === null ? (
          <>
            <Alert variant="warning">{copy.print.warning}</Alert>

            {/* Listed, never enforced: the print button stays enabled. */}
            <OverflowNotice warnings={warnings} />

            <div className="space-y-1">
              <Label>{copy.print.printer}</Label>
              <Select
                value={selectedPrinterId ?? ''}
                onChange={(event) => onSelectPrinter(event.target.value)}
              >
                <option value="">—</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{copy.print.copies}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
              />
            </div>

            <FieldForm
              fields={form.data?.fields ?? []}
              copies={copies}
              manualValues={manualValues}
              sequenceOverrides={sequenceOverrides}
              onChangeManual={(name, value) => setManualValues((prev) => ({ ...prev, [name]: value }))}
              onChangeOverride={(name, value) =>
                setSequenceOverrides((prev) => ({ ...prev, [name]: value }))
              }
            />

            {blocked !== null && <Alert>{blocked}</Alert>}

            {error !== null && (
              <Alert variant={error.needsSomeoneOnSite ? 'warning' : 'destructive'}>
                <p className="font-medium">{error.body.what}</p>
                <p className="mt-1 text-xs opacity-90">{error.body.why}</p>
                <p className="mt-1 text-xs font-medium">{error.body.next}</p>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {copy.print.cancel}
              </Button>
              <Button disabled={blocked !== null || submitting} onClick={() => void submit()}>
                {submitting ? copy.print.submitting : copy.print.confirm}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Accepted, not finished: the labels are still coming out. */}
            <Alert>{copy.print.queued}</Alert>
            <p className="font-mono text-xs text-muted-foreground">
              {copy.print.queuedDetail(result.jobId)}
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>{copy.common.close}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
