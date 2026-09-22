/**
 * The last look before the paper moves.
 *
 * This page *is* the confirmation, which is why there is no standing warning
 * on it: five lines saying what will be printed, where, and how many, and one
 * button. The only sentence that ever appears beyond them is the one that says
 * something will be lost — and it appears only when something will.
 *
 * An idempotency key is minted once per arrival here. A retry after a failed
 * or flaky submission reuses it and gets the same job back; going back to
 * change the choices and returning is a different batch and gets a new one.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { LabelIR } from '@zenith/shared'
import { ApiRequestError, request } from '../../api/client.ts'
import type { Printer, PrintJobSummary } from '../../api/types.ts'
import type { Profile } from '../profiles/hooks.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { randomId } from '../../lib/random-id.ts'
import { useDataSources } from '../data-sources/hooks.ts'
import type { Template } from '../templates/hooks.ts'
import { clipSummary, type OverflowWarning, type Tally } from './flow.ts'
import { toRowSelection, type Selection } from './selection.ts'

export interface ConfirmStepProps {
  ir: LabelIR
  template: Template | null
  templateId: string | null
  printer: Printer | null
  profile: Profile | null
  profileId: string | null
  variableValues: Readonly<Record<string, string>>
  dataSourceId: string | null
  selection: Selection
  chosenRows: number
  keyByOrdinal: ReadonlyMap<number, string>
  copies: number
  tally: Tally
  blocked: string | null
  onBack: () => void
  /** Same label, same machine, a new set of rows. */
  onAgain: () => void
  onLabels: () => void
  onQueue: () => void
}

function Line({ term, children }: { term: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-sm" data-term={term}>
        {children}
      </dd>
    </>
  )
}

export function ConfirmStep(props: ConfirmStepProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)
  const [result, setResult] = useState<PrintJobSummary | null>(null)
  const [warnings, setWarnings] = useState<readonly OverflowWarning[]>([])

  // Minted once per arrival. Not `crypto.randomUUID()`: that exists only in a
  // secure context, and this service is plain HTTP on a LAN address.
  const idempotencyKey = useMemo(() => randomId(), [])

  const source = useDataSources().data?.find((candidate) => candidate.id === props.dataSourceId)
  const printer = props.printer

  const jobBody = (): Record<string, unknown> => ({
    printerId: printer?.id,
    // The design on screen, always — that is what the operator is looking at
    // and expects to get. The template id rides along when there is one, so
    // history says which template this batch belongs to and the sequence
    // fields are claimed from it.
    ir: props.ir,
    ...(props.templateId === null ? {} : { templateId: props.templateId }),
    ...(props.profileId === null ? {} : { profileId: props.profileId }),
    copies: props.copies,
    ...(props.dataSourceId === null
      ? {}
      : { rowSelection: toRowSelection(props.selection) }),
  })

  /**
   * Ask what will be clipped, once, on arrival.
   *
   * A barcode bound to a column has no fixed width — the module count follows
   * the content — so row 7 of a hundred can overflow while the design looks
   * fine. Only the server can say, and a preflight that fails is not a reason
   * to stop anybody printing.
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
          // A body without `warnings` is not an answer this page can read, and
          // it must not take the page down on the way to finding that out:
          // the preflight is advisory, and the print button is not its to
          // disable.
          setWarnings(response.warnings ?? [])
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Asked once per arrival and whenever the batch's shape changes. The body
    // is rebuilt on every render; listing it would ask the server on every
    // keystroke.
  }, [printer?.id, props.templateId, props.profileId, props.copies])

  const risk = clipSummary({
    warnings,
    labelWidthMm: props.ir.widthMm,
    capabilities: printer?.capabilities ?? null,
  })

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

  if (result !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-n4" data-print-result>
        <span className="grid size-11 place-items-center rounded-full border border-success text-success">
          <Check className="size-5" aria-hidden />
        </span>
        {/* Accepted, not finished: the labels are still coming out. */}
        <p className="text-base">{copy.print.queuedCount(props.tally.labels)}</p>
        <p className="font-mono text-xs text-muted-foreground">{copy.print.queuedDetail(result.jobId)}</p>
        <div className="flex items-center gap-n4 pt-n2">
          <Button variant="outline" size="sm" onClick={props.onQueue}>
            {copy.print.toQueue}
          </Button>
          <Button variant="outline" size="sm" onClick={props.onAgain} data-again>
            {copy.print.again}
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onLabels}>
            {copy.print.backToLabels}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-themed mx-auto flex w-full max-w-lg min-h-0 flex-1 flex-col gap-n8 overflow-y-auto pt-n4">
        <h1 className="text-xl font-medium">{copy.flow.steps.confirm}</h1>

        <dl className="grid grid-cols-[6rem_1fr] items-baseline gap-x-n6 gap-y-n4">
          <Line term={copy.presets.template}>
            {props.template?.name ?? copy.workspace.untitledDesign}
            <span className="mt-1 block text-2xs text-muted-foreground">
              {props.ir.widthMm} × {props.ir.heightMm} mm
            </span>
          </Line>
          <Line term={copy.print.printer}>
            {printer?.name ?? '—'}
            {printer !== null && (
              <span className="mt-1 block text-2xs text-muted-foreground">{printer.address}</span>
            )}
          </Line>
          <Line term={copy.profiles.heading}>
            {props.profile?.name ?? copy.presets.profileDefault}
            {props.profile !== null && (
              <span className="mt-1 block text-2xs text-muted-foreground">
                {props.profile.labelWidthMm} × {props.profile.labelHeightMm} mm
              </span>
            )}
          </Line>
          {props.dataSourceId !== null && (
            <Line term={copy.dataSources.heading}>
              {source?.name ?? props.dataSourceId}
              <span className="mt-1 block text-2xs text-muted-foreground">
                {copy.rowSelection.chosen(props.chosenRows)}
              </span>
            </Line>
          )}
          <Line term={copy.print.copiesPerRow}>{props.copies}</Line>
          {risk !== null && (
            <Line term={copy.print.clipTerm}>
              <span className="text-destructive" data-clip>
                {copy.print.clipLine(risk)}
              </span>
            </Line>
          )}
        </dl>

        <div className="flex items-baseline gap-n3 border-t border-border pt-n6">
          <span className="font-mono text-3xl font-medium" data-total>
            {props.tally.labels}
          </span>
          <span className="text-sm">{copy.print.sheets}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {copy.print.seconds(props.tally.seconds)}
          </span>
        </div>

        {error !== null && (
          <Alert variant={error.needsSomeoneOnSite ? 'warning' : 'destructive'} data-submit-error>
            <p className="font-medium">{error.body.what}</p>
            <p className="mt-1 text-xs opacity-90">{error.body.why}</p>
            <p className="mt-1 text-xs font-medium">{error.body.next}</p>
          </Alert>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-n3 border-t border-border pt-3">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          {copy.flow.previous}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto border-primary text-accent-300"
          disabled={props.blocked !== null || submitting}
          title={props.blocked ?? undefined}
          onClick={() => void submit()}
          data-submit
        >
          {submitting ? copy.print.submitting : copy.print.action}
        </Button>
      </div>
    </div>
  )
}
