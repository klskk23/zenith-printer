/**
 * The four steps, as arithmetic.
 *
 * A label has four places to stand — the gallery, the design, the print
 * choices, the last look — and three different components need to agree about
 * them: the step bar draws which are reachable, the print step disables its
 * own "continue" button, and the session refuses to open the confirm step when
 * there is nothing to submit. Three readers of one rule, so the rule lives
 * here where it can be tested without a DOM.
 *
 * Nothing in this file touches React.
 */
import type { PageKind } from '../../app/routes.ts'
import type { Capabilities, Printer } from '../../api/types.ts'
import { copy } from '../../i18n/index.ts'
import { MAX_LABELS_PER_JOB } from './selection.ts'

export type StepId = 'labels' | 'design' | 'print' | 'confirm'

/**
 * `past` is behind you and clickable, `ahead` is not yet reachable, `blocked`
 * is the confirm step while the print step has an unanswered question.
 */
export type StepState = 'past' | 'current' | 'ahead' | 'blocked'

export interface Step {
  id: StepId
  ordinal: 1 | 2 | 3 | 4
  state: StepState
}

const ORDER: readonly { id: StepId; ordinal: 1 | 2 | 3 | 4 }[] = [
  { id: 'labels', ordinal: 1 },
  { id: 'design', ordinal: 2 },
  { id: 'print', ordinal: 3 },
  { id: 'confirm', ordinal: 4 },
]

const CURRENT: Partial<Record<PageKind, StepId>> = {
  labels: 'labels',
  label: 'design',
  'label-print': 'print',
  'label-confirm': 'confirm',
}

/**
 * Which steps are behind, which is current, which cannot be reached yet.
 *
 * `canSubmit` gates the last step only: a printer has been chosen and, where a
 * table is bound, at least one row is ticked. Everything before it is reachable
 * whenever a label is open — printing does not require passing through the
 * editor, and editing does not require having printed.
 */
export function stepsFor(input: { page: PageKind; canSubmit: boolean }): readonly Step[] {
  const current = CURRENT[input.page] ?? 'labels'
  const at = ORDER.find((step) => step.id === current)!.ordinal
  return ORDER.map(({ id, ordinal }) => ({
    id,
    ordinal,
    state:
      ordinal < at
        ? 'past'
        : ordinal === at
          ? 'current'
          : // `blocked` is only said by the step that is refusing you right
            // now: standing on the print step with nothing submittable. From
            // the gallery or the editor the last step is merely far off, and
            // painting it as refused would blame the person for not having
            // made choices nobody has asked them for yet.
            id === 'confirm' && at === 3 && !input.canSubmit
            ? 'blocked'
            : 'ahead',
  }))
}

/**
 * A guess at how long the batch takes, in milliseconds per label.
 *
 * The capabilities carry dpi and head width but no speed, and the print
 * history is empty on a fresh deployment — so this is a deliberately
 * conservative constant rather than a measurement. The copy says "about",
 * and nothing in the product treats it as a promise.
 */
const MS_PER_LABEL = 1200

export interface Tally {
  /** Sheets of paper that will come out. */
  labels: number
  /** Rounded up; zero labels take zero seconds. */
  seconds: number
}

export function tally(input: {
  /** `null` when the label is not bound to a table. */
  boundRows: number | null
  chosenRows: number
  copies: number
}): Tally {
  const labels = input.boundRows === null ? input.copies : input.chosenRows * input.copies
  return { labels, seconds: Math.ceil((labels * MS_PER_LABEL) / 1000) }
}

/**
 * Why printing cannot go ahead, or `null`.
 *
 * Order is the order somebody would fix them in, which is also the order they
 * become knowable: without a machine nothing else can be judged, an unprobed
 * machine has no head width, and a reference nothing resolves would print the
 * literal `${sku}`.
 */
export function blockReason(input: {
  printer: Printer | null
  unresolved: readonly string[]
  dataSourceId: string | null
  chosenRows: number
  labels: number
}): string | null {
  if (input.printer === null) {
    return copy.print.needsPrinter
  }
  if (input.printer.capabilities === null) {
    return copy.print.needsProbe
  }
  if (input.unresolved.length > 0) {
    return copy.variables.unresolved(input.unresolved.join('、'))
  }
  if (input.dataSourceId !== null && input.chosenRows === 0) {
    return copy.rowSelection.none
  }
  if (input.labels > MAX_LABELS_PER_JOB) {
    return copy.print.batchTooLarge(input.labels, MAX_LABELS_PER_JOB)
  }
  return null
}

/**
 * One warning from `POST /print-jobs/preflight`, as the server sends it
 * (`packages/server/src/domain/overflow.ts`).
 */
export interface OverflowWarning {
  rowIndex: number
  elementId: string
  reason: 'ELEMENT_OUT_OF_BOUNDS' | 'BARCODE_TOO_WIDE'
  actualWidthMm: number
  availableWidthMm: number
}

export interface ClipRisk {
  /** How many labels in the batch lose content. */
  affected: number
  /** The worst overflow among them, in millimetres. */
  overflowMm: number
  /** How far the label sticks out past the print head; 0 when it fits. */
  beyondHeadMm: number
  /** Nobody has probed this machine, so the printable width is unknown. */
  unprobed: boolean
}

const dotsToMm = (dots: number, dpi: number): number => (dots * 25.4) / dpi
const round1 = (mm: number): number => Math.round(mm * 10) / 10

/**
 * What will be lost, or `null` when nothing will be.
 *
 * `null` is the normal answer, and it is why the confirm step is silent on the
 * ordinary path: a warning that is always there is a warning nobody reads.
 * Per-label clipping can only come from the server — a barcode bound to a
 * column has no fixed width, so row 7 of a hundred can overflow while the
 * design looks fine — and the head comparison can only be made here, where the
 * chosen machine is known.
 */
export function clipSummary(input: {
  warnings: readonly OverflowWarning[]
  labelWidthMm: number
  capabilities: Capabilities | null
}): ClipRisk | null {
  const unprobed = input.capabilities === null
  const beyondHeadMm =
    input.capabilities === null
      ? 0
      : Math.max(
          0,
          round1(input.labelWidthMm - dotsToMm(input.capabilities.printheadPixels, input.capabilities.dpi)),
        )
  const warnings = input.warnings ?? []
  const affectedLabels = new Set(warnings.map((warning) => warning.rowIndex))
  const overflowMm = warnings.reduce(
    (worst, warning) => Math.max(worst, round1(warning.actualWidthMm - warning.availableWidthMm)),
    0,
  )
  if (affectedLabels.size === 0 && beyondHeadMm === 0 && !unprobed) {
    return null
  }
  return { affected: affectedLabels.size, overflowMm, beyondHeadMm, unprobed }
}
