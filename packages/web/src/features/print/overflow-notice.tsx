/**
 * What will be clipped.
 *
 * Shown before submitting, and never as a blocker. Overflow is a judgement
 * about this particular label — is a clipped edge acceptable this time — and
 * whoever is holding the roll is better placed to make it than the software.
 * Holding back ninety-nine good labels because one will be clipped is the worse
 * outcome: the labels in a batch usually correspond to something, and a batch
 * with gaps is harder to sort out than a reprint.
 *
 * Every affected row is listed, not just the first, so one pass is enough.
 */
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'

export interface OverflowWarning {
  rowIndex: number
  elementId: string
  reason: 'ELEMENT_OUT_OF_BOUNDS' | 'BARCODE_TOO_WIDE'
  actualWidthMm: number
  availableWidthMm: number
}

export function OverflowNotice({ warnings }: { warnings: OverflowWarning[] }): React.JSX.Element | null {
  if (warnings.length === 0) {
    return null
  }

  return (
    <Alert variant="warning" className="space-y-1 text-xs">
      <p className="font-medium">{copy.overflow.heading}</p>
      <ul className="space-y-0.5">
        {warnings.map((warning, index) => (
          <li key={`${warning.rowIndex}-${warning.elementId}-${index}`} className="font-mono">
            {copy.overflow.row(warning.rowIndex)} · {copy.overflow.reasons[warning.reason]} ·{' '}
            {copy.overflow.widths(warning.actualWidthMm, warning.availableWidthMm)}
          </li>
        ))}
      </ul>
      {/* The important sentence: this is information, not a refusal. */}
      <p className="opacity-90">{copy.overflow.note}</p>
    </Alert>
  )
}
