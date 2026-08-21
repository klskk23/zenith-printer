/**
 * Variable field editor.
 *
 * The feature that stops a template library filling up with near-copies that
 * differ by one string. Two kinds of field, and the difference is worth making
 * visible in the UI:
 *
 *   - manual: typed in before printing, shared by every copy in the batch
 *   - sequence: stepped per copy, so eighty labels carry eighty numbers
 *
 * The digit width is prominent because it is the setting people get wrong: a
 * three-digit field prints 080, a two-digit one prints 80, and only one of
 * those sorts correctly.
 */
import { isVariableRef, type LabelElement } from '@zenith/shared'
import { copy } from '../i18n/zh-CN.ts'
import type { VariableField } from '../features/templates/hooks.ts'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select } from '../components/ui/select.tsx'
import { Alert } from '../components/ui/alert.tsx'

export interface VariableFieldPanelProps {
  element: LabelElement | null
  fields: VariableField[]
  onChangeFields: (fields: VariableField[]) => void
  onBindElement: (elementId: string, fieldName: string | null) => void
}

function canHoldField(element: LabelElement | null): boolean {
  return element !== null && (element.type === 'text' || element.type === 'barcode' || element.type === 'qrcode')
}

function boundFieldName(element: LabelElement | null): string | null {
  if (element === null || !canHoldField(element) || !('content' in element)) {
    return null
  }
  return isVariableRef(element.content) ? element.content.$var : null
}

export function VariableFieldPanel({
  element,
  fields,
  onChangeFields,
  onBindElement,
}: VariableFieldPanelProps): React.JSX.Element {
  const bound = boundFieldName(element)

  const patch = (name: string, changes: Partial<VariableField>): void => {
    onChangeFields(fields.map((field) => (field.name === name ? { ...field, ...changes } : field)))
  }

  const addField = (source: VariableField['source']): void => {
    const name = `field${fields.length + 1}`
    const field: VariableField =
      source === 'manual'
        ? { name, label: name, source, sampleValue: 'SAMPLE' }
        : { name, label: name, source, seqStart: 1, seqDigits: 3, seqStep: 1 }
    onChangeFields([...fields, field])
    if (element !== null && canHoldField(element)) {
      onBindElement(element.id, name)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{copy.fields.heading}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => addField('manual')}>
            {copy.fields.addManual}
          </Button>
          <Button size="sm" variant="outline" onClick={() => addField('sequence')}>
            {copy.fields.addSequence}
          </Button>
        </div>
      </div>

      {canHoldField(element) ? (
        <div className="space-y-1">
          <Label>{copy.fields.bindTo}</Label>
          <Select
            value={bound ?? ''}
            onChange={(event) => onBindElement(element!.id, event.target.value || null)}
          >
            <option value="">{copy.fields.unbound}</option>
            {fields.map((field) => (
              <option key={field.name} value={field.name}>
                {field.label}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.fields.notBindable}</p>
      )}

      {fields.length === 0 && <p className="text-xs text-muted-foreground">{copy.fields.empty}</p>}

      {fields.map((field) => (
        <div key={field.name} className="space-y-2 rounded-md border border-border p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {field.source === 'manual' ? copy.fields.manual : copy.fields.sequence}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChangeFields(fields.filter((f) => f.name !== field.name))}
            >
              {copy.fields.remove}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>{copy.fields.name}</Label>
              <Input value={field.name} onChange={(e) => patch(field.name, { name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{copy.fields.label}</Label>
              <Input value={field.label} onChange={(e) => patch(field.name, { label: e.target.value })} />
            </div>
          </div>

          {field.source === 'manual' ? (
            <div className="space-y-1">
              <Label>{copy.fields.sampleValue}</Label>
              <Input
                value={field.sampleValue ?? ''}
                onChange={(e) => patch(field.name, { sampleValue: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">{copy.fields.sampleHint}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>{copy.fields.seqStart}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={field.seqStart ?? 1}
                    onChange={(e) => patch(field.name, { seqStart: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{copy.fields.seqDigits}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={field.seqDigits ?? 3}
                    onChange={(e) => patch(field.name, { seqDigits: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{copy.fields.seqStep}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={field.seqStep ?? 1}
                    onChange={(e) => patch(field.name, { seqStep: Number(e.target.value) || 1 })}
                  />
                </div>
              </div>
              <Alert className="text-[11px]">
                {copy.fields.seqPreview(field.seqStart ?? 1, field.seqDigits ?? 3, field.seqStep ?? 1)}
              </Alert>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
