/**
 * Field values collected before printing.
 *
 * Two things worth pointing out in the UI:
 *
 *   - the suggested starting value for each sequence, so nobody has to
 *     remember what they printed last week (FR-048)
 *   - that the suggestion can be overridden, because reprinting a spoiled
 *     batch with its original numbers is a legitimate thing to want
 *
 * The range the batch will consume is shown before submitting, since a serial
 * that turns out wrong is only discovered once the labels are on boxes.
 */
import { copy } from '../../i18n/index.ts'
import type { PrintFormField } from '../templates/hooks.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'

export interface FieldFormProps {
  fields: PrintFormField[]
  copies: number
  manualValues: Record<string, string>
  sequenceOverrides: Record<string, number>
  onChangeManual: (name: string, value: string) => void
  onChangeOverride: (name: string, value: number) => void
}

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, '0')
}

export function FieldForm({
  fields,
  copies,
  manualValues,
  sequenceOverrides,
  onChangeManual,
  onChangeOverride,
}: FieldFormProps): React.JSX.Element | null {
  if (fields.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        if (field.source === 'manual') {
          return (
            <div key={field.name} className="space-y-1">
              <Label>{field.label}</Label>
              <Input
                value={manualValues[field.name] ?? ''}
                placeholder={field.sampleValue}
                onChange={(event) => onChangeManual(field.name, event.target.value)}
              />
            </div>
          )
        }

        const digits = field.seqDigits ?? 3
        const step = field.seqStep ?? 1
        const suggested = field.suggestedStart ?? 1
        const start = sequenceOverrides[field.name] ?? suggested
        const end = start + (copies - 1) * step
        const max = field.maxRepresentable ?? 10 ** digits - 1
        const overflows = end > max
        // Anything below the suggestion has been issued before.
        const conflicts = start < suggested

        return (
          <div key={field.name} className="space-y-1">
            <Label>{field.label}</Label>
            <Input
              type="number"
              min={0}
              value={start}
              onChange={(event) => onChangeOverride(field.name, Number(event.target.value) || 0)}
            />
            {conflicts && !overflows && (
              // Not an error: reprinting a spoiled batch with its original
              // numbers is a legitimate thing to want. Saying nothing would be
              // worse — duplicate serials are the failure this feature exists
              // to prevent.
              <Alert variant="warning" className="text-[11px]">
                {copy.printForm.conflict(pad(start, digits), pad(suggested, digits))}
              </Alert>
            )}

            {overflows ? (
              // Refused server-side too; saying so here avoids a round trip
              // and explains what to change.
              <Alert variant="destructive" className="text-[11px]">
                {copy.printForm.overflow(end, max, digits)}
              </Alert>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {copy.printForm.range(pad(start, digits), pad(end, digits), copies)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
