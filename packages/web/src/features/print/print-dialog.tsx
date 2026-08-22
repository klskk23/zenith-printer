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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { OverflowNotice, type OverflowWarning } from './overflow-notice.tsx'
import { Preview } from './preview.tsx'
import { RowSelectionPanel } from './row-selection.tsx'
import { RefreshButton } from '../data-sources/refresh-button.tsx'
import {
  EMPTY,
  MAX_LABELS_PER_JOB,
  labelTotal,
  selectedCount,
  toRowSelection,
  type Selection,
} from './selection.ts'
import { useDataSources } from '../data-sources/hooks.ts'
import { randomId } from '../../lib/random-id.ts'

export interface PrintDialogProps {
  ir: LabelIR
  /** When set, the job prints from the saved template rather than this IR. */
  templateId: string | null
  profileId: string | null
  /**
   * Values the design's own variables resolve to, from the editor.
   *
   * Taken from what is on screen rather than from the saved template: an
   * unsaved design has no template to ask, and a saved one may have been
   * edited since — and edits do print, because the design goes with the job.
   */
  variableValues: Readonly<Record<string, string>>
  /**
   * References the content makes that nothing resolves.
   *
   * Blocks submission. The label would otherwise come out reading "${sku}",
   * which is waste that looks like output.
   */
  unresolved: readonly string[]
  /** The data source this design is bound to, or null. */
  dataSourceId: string | null
  /**
   * The machine this is going to.
   *
   * Chosen on the editor's toolbar, and the print button there is disabled
   * until it is — so offering the choice again here asked a question that had
   * already been answered, in a dialog whose job is to confirm.
   */
  printer: Printer
  onClose: () => void
}

export function PrintDialog({
  ir,
  templateId,
  profileId,
  printer,
  variableValues,
  unresolved,
  dataSourceId,
  onClose,
}: PrintDialogProps): React.JSX.Element {
  const [copies, setCopies] = useState(1)
  const [selection, setSelection] = useState<Selection>(EMPTY)
  const [selectionCleared, setSelectionCleared] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [warnings, setWarnings] = useState<OverflowWarning[]>([])
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [result, setResult] = useState<PrintJobSummary | null>(null)

  // Minted once per dialog opening. A retry — from a double click, a flaky
  // network, or the browser replaying the request — reuses it and gets the
  // same job back rather than a second stack of labels.
  //
  // Not `crypto.randomUUID()`: that one exists only in a secure context, and
  // this service is plain HTTP on a LAN address. See lib/random-id.ts.
  const idempotencyKey = useMemo(() => randomId(), [])

  // A printer that has never been probed has no head width or dpi, so nothing
  // downstream can decide what fits. An unresolved reference blocks for a
  // blunter reason: the label would come out reading "${sku}".
  // The count comes off the data source, which already carries it. Fetching a
  // page of rows to read a number is a wasted request, and it was the request
  // that collided with the selection panel's.
  const boundSource = useDataSources().data?.find((source) => source.id === dataSourceId)
  const rowCount = boundSource?.rowCount ?? 0
  const linkedSource = boundSource?.sourceKind === 'google-sheets' ? boundSource : undefined
  const chosenRows = dataSourceId === null ? 0 : selectedCount(selection, rowCount)
  const labels = dataSourceId === null ? copies : labelTotal(selection, rowCount, copies)
  const firstOrdinal =
    selection.kind === 'all'
      ? 1
      : [...selection.ordinals].sort((a, b) => a - b)[0]

  const blocked =
    printer.capabilities === null
      ? copy.print.needsProbe
      : unresolved.length > 0
        ? copy.variables.unresolved(unresolved.join('、'))
        : dataSourceId !== null && chosenRows === 0
          ? copy.rowSelection.none
          : labels > MAX_LABELS_PER_JOB
            ? copy.print.batchTooLarge(labels, MAX_LABELS_PER_JOB)
            : null

  const jobBody = (): Record<string, unknown> => ({
    printerId: printer.id,
    // The design on screen, always — that is what the operator is looking at
    // and expects to get. The template id rides along when there is one, so
    // history says which template this batch belongs to and the sequence
    // fields are claimed from it.
    ir,
    ...(templateId === null ? {} : { templateId }),
    ...(profileId === null ? {} : { profileId }),
    copies,
    ...(dataSourceId === null ? {} : { rowSelection: toRowSelection(selection) }),
  })

  /**
   * Ask what will be clipped before submitting.
   *
   * A barcode bound to a variable field has no fixed width — the module count
   * follows the content — so row 7 of a hundred can overflow while the design
   * looks fine. This is the only place that can be known.
   */
  useEffect(() => {
    if (printer.capabilities === null) {
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
  }, [printer.id, templateId, profileId, copies])

  const submit = async (): Promise<void> => {
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
    // shadcn's Dialog rather than a hand-rolled overlay: it brings the focus
    // trap, the Escape key and the scroll lock with it, and it stacks properly
    // with the confirmations that open on top of it.
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{copy.print.heading}</DialogTitle>
          <DialogDescription>{printer.name}</DialogDescription>
        </DialogHeader>

        {/*
          A native scroller, not a ScrollArea, for two reasons that both showed
          up here at once.

          Radix's viewport is the element that actually scrolls and it is sized
          `height: 100%`, so it needs a parent with a *definite* height. Given
          only `max-height` the percentage resolves to auto: the viewport grows
          as tall as its content, the root clips it, and nothing scrolls at all.

          And the row preview inside is a `<table>` in its own `overflow-x-auto`
          box. Radix wraps viewport content in a `display: table` element, which
          shrink-wraps that box to the table's full width, so it never overflows
          and never offers a horizontal scrollbar — the table is simply cut off.

          `flex-1 min-h-0` under the flex column above gives this element a
          definite height of its own, and it is its own scroller, so the table
          inside keeps its.
        */}
        <div className="scrollbar-themed min-h-0 flex-1 space-y-4 overflow-y-auto pr-3">

        {result === null ? (
          <>
            <Alert variant="warning">{copy.print.warning}</Alert>

            {/* Listed, never enforced: the print button stays enabled. */}
            <OverflowNotice warnings={warnings} />

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

            {/*
              Above the selector, and it clears the selection when it lands.
              A selection is a set of ordinals; after the table is replaced
              those numbers point at different rows, so keeping them would
              print the wrong labels while looking entirely correct.
            */}
            {linkedSource !== undefined && (
              <div className="space-y-1" data-print-refresh>
                <RefreshButton
                  source={linkedSource}
                  onApplied={() => {
                    setSelection(EMPTY)
                    setSelectionCleared(true)
                  }}
                />
                {selectionCleared && (
                  <p className="text-[11px] text-muted-foreground" data-selection-cleared>
                    {copy.dataSources.refreshClearedSelection}
                  </p>
                )}
              </div>
            )}

            {dataSourceId !== null && (
              <RowSelectionPanel
                dataSourceId={dataSourceId}
                selection={selection}
                onChange={setSelection}
                copies={copies}
              />
            )}

            {/*
              The first label of the batch, not a composite of none of them:
              a sequence counts up and each row differs, so label 40 is not
              label 1 (FR-041).
            */}
            <Preview
              ir={ir}
              printerId={printer.id}
              profileId={profileId}
              variableValues={unresolved.length > 0 ? null : variableValues}
              // The first row of the batch in print order, which is the first
              // label that will actually come out.
              rowOrdinal={dataSourceId === null ? undefined : firstOrdinal}
              copies={copies}
            />

            {blocked !== null && <Alert>{blocked}</Alert>}

            {error !== null && (
              <Alert variant={error.needsSomeoneOnSite ? 'warning' : 'destructive'}>
                <p className="font-medium">{error.body.what}</p>
                <p className="mt-1 text-xs opacity-90">{error.body.why}</p>
                <p className="mt-1 text-xs font-medium">{error.body.next}</p>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {copy.print.cancel}
              </Button>
              <Button disabled={blocked !== null || submitting} onClick={() => void submit()}>
                {submitting ? copy.print.submitting : copy.print.confirm}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* Accepted, not finished: the labels are still coming out. */}
            <Alert>{copy.print.queued}</Alert>
            <p className="font-mono text-xs text-muted-foreground">
              {copy.print.queuedDetail(result.jobId)}
            </p>
            <DialogFooter>
              <Button onClick={onClose}>{copy.common.close}</Button>
            </DialogFooter>
          </>
        )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
