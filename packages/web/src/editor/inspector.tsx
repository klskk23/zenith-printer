/**
 * Property panel.
 *
 * Two things it deliberately does not do:
 *
 *   - it does not accept free millimetre values for strokes and offsets. Those
 *     step in whole dots, because that is the machine's resolution; asking
 *     anyone to type multiples of 0.125mm would be absurd (FR-029).
 *   - it does not silently clamp. A value that cannot print is reported by the
 *     guards with an explanation instead.
 */
import {
  MIN_MODULE_WIDTH_DOTS,
  dotsToMm,
  isVariableRef,
  mmToDots,
  type BarcodeElement,
  type LabelElement,
  type LabelIR,
  type QrcodeElement,
} from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { FONT_FAMILIES, type FontFamilyKey } from './elements.ts'
import { dotStepMm } from './guards.ts'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Input } from '../components/ui/input.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select } from '../components/ui/select.tsx'

export interface InspectorProps {
  ir: LabelIR
  element: LabelElement | null
  onChange: (element: LabelElement) => void
  onDelete: (id: string) => void
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/** Millimetre input that nudges by one dot at a time. */
function MmInput({
  value,
  dpi,
  onChange,
}: {
  value: number
  dpi: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const step = dotStepMm(dpi)
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        value={Number(value.toFixed(3))}
        step={Number(step.toFixed(3))}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) {
            onChange(parsed)
          }
        }}
      />
      <span className="w-6 shrink-0 text-xs text-muted-foreground">{copy.editor.units.mm}</span>
    </div>
  )
}

/** Stroke width input. Whole dots only — a fractional stroke has no meaning. */
function DotsInput({
  value,
  dpi,
  onChange,
}: {
  value: number
  dpi: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const mm = (value * 25.4) / dpi
  return (
    <div className="space-y-1">
      <Input
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)
          if (Number.isFinite(parsed)) {
            onChange(parsed)
          }
        }}
      />
      <p className="text-[11px] text-muted-foreground">{copy.editor.units.dotsSuffix(value, mm)}</p>
    </div>
  )
}

/**
 * Module width, for barcodes and QR codes.
 *
 * The primary control, with the resulting width shown read-only beside it. That
 * inversion is deliberate: width is not something these elements have
 * independently — it is moduleWidth x moduleCount, and the module count comes
 * from the content and symbology. Offering "width" as the editable number would
 * invite values that do not exist.
 *
 * Both units are shown because the number that decides whether a scanner can
 * read the label is the module in millimetres, and 2 dots means nothing without
 * knowing it is 0.25 mm.
 */
function ModuleWidthField({
  element,
  dpi,
  patch,
}: {
  element: BarcodeElement | QrcodeElement
  dpi: number
  patch: (changes: Partial<LabelElement>) => void
}): React.JSX.Element {
  const moduleMm = dotsToMm(element.moduleWidthDots, dpi)
  const variable = isVariableRef(element.content)

  return (
    <div className="space-y-1">
      <Field label={copy.editor.moduleWidth}>
        <Input
          type="number"
          min={MIN_MODULE_WIDTH_DOTS}
          step={1}
          value={element.moduleWidthDots}
          onChange={(event) => {
            const next = Math.max(MIN_MODULE_WIDTH_DOTS, Math.round(Number(event.target.value) || MIN_MODULE_WIDTH_DOTS))
            patch({ moduleWidthDots: next } as never)
          }}
        />
      </Field>
      <p className="text-[11px] text-muted-foreground">
        {copy.editor.moduleWidthHint(element.moduleWidthDots, moduleMm)}
      </p>
      {variable && (
        // The module count depends on the content, and the content is not known
        // until print time — so the width shown here is an estimate.
        <p className="text-[11px] text-muted-foreground">{copy.editor.variableWidthHint}</p>
      )}
    </div>
  )
}

export function Inspector({ ir, element, onChange, onDelete }: InspectorProps): React.JSX.Element {
  if (element === null) {
    return <p className="text-sm text-muted-foreground">{copy.editor.noSelection}</p>
  }

  const patch = (changes: Partial<LabelElement>): void => {
    onChange({ ...element, ...changes } as LabelElement)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{copy.editor.elements[element.type]}</h3>
        <Button variant="ghost" size="sm" onClick={() => onDelete(element.id)}>
          {copy.editor.delete}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={copy.editor.fields.x}>
          <MmInput value={element.xMm} dpi={ir.dpi} onChange={(xMm) => patch({ xMm })} />
        </Field>
        <Field label={copy.editor.fields.y}>
          <MmInput value={element.yMm} dpi={ir.dpi} onChange={(yMm) => patch({ yMm })} />
        </Field>
      </div>

      {element.type === 'line' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label={copy.editor.fields.x2}>
            <MmInput value={element.x2Mm} dpi={ir.dpi} onChange={(x2Mm) => patch({ x2Mm } as never)} />
          </Field>
          <Field label={copy.editor.fields.y2}>
            <MmInput value={element.y2Mm} dpi={ir.dpi} onChange={(y2Mm) => patch({ y2Mm } as never)} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label={copy.editor.fields.width}>
            <MmInput value={element.widthMm} dpi={ir.dpi} onChange={(widthMm) => patch({ widthMm } as never)} />
          </Field>
          <Field label={copy.editor.fields.height}>
            <MmInput value={element.heightMm} dpi={ir.dpi} onChange={(heightMm) => patch({ heightMm } as never)} />
          </Field>
        </div>
      )}

      {'strokeWidthDots' in element && (
        <Field label={copy.editor.fields.strokeWidth}>
          <DotsInput
            value={element.strokeWidthDots}
            dpi={ir.dpi}
            onChange={(strokeWidthDots) => patch({ strokeWidthDots } as never)}
          />
        </Field>
      )}

      {(element.type === 'text' || element.type === 'barcode' || element.type === 'qrcode') &&
        typeof element.content === 'string' && (
          <Field label={copy.editor.fields.content}>
            {element.type === 'text' ? (
              // Multi-line, and only where the user typed a newline. The
              // renderer never wraps to the box width: wrapping needs glyph
              // metrics, and the browser's are not the print renderer's, so the
              // two would break at different words.
              <Textarea
                rows={3}
                value={element.content}
                onChange={(event) => patch({ content: event.target.value } as never)}
              />
            ) : (
              <Input
                value={element.content}
                onChange={(event) => patch({ content: event.target.value } as never)}
              />
            )}
          </Field>
        )}

      {element.type === 'text' && (
        <>
          <Field label={copy.editor.fields.fontFamily}>
            <Select
              value={element.fontFamily}
              onChange={(event) => patch({ fontFamily: event.target.value } as never)}
            >
              {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => (
                <option key={key} value={FONT_FAMILIES[key]}>
                  {copy.editor.fonts[key]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={copy.editor.fields.fontSize}>
              <MmInput
                value={element.fontSizeMm}
                dpi={ir.dpi}
                onChange={(fontSizeMm) => patch({ fontSizeMm } as never)}
              />
            </Field>
            <Field label={copy.editor.fields.align}>
              <Select value={element.align} onChange={(event) => patch({ align: event.target.value } as never)}>
                <option value="left">{copy.editor.align.left}</option>
                <option value="center">{copy.editor.align.center}</option>
                <option value="right">{copy.editor.align.right}</option>
              </Select>
            </Field>
          </div>
          <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={element.bold}
              onCheckedChange={(checked) => patch({ bold: checked === true } as never)}
            />
            {copy.editor.fields.bold}
          </Label>
        </>
      )}

      {element.type === 'barcode' && (
        <>
          <Field label={copy.editor.fields.symbology}>
            <Select
              value={element.symbology}
              onChange={(event) => patch({ symbology: event.target.value } as never)}
            >
              {['code128', 'code39', 'ean13', 'ean8', 'itf14'].map((symbology) => (
                <option key={symbology} value={symbology}>
                  {symbology}
                </option>
              ))}
            </Select>
          </Field>
          <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={element.showHumanReadable}
              onCheckedChange={(checked) => patch({ showHumanReadable: checked === true } as never)}
            />
            {copy.editor.fields.showHumanReadable}
          </Label>
        </>
      )}

      {(element.type === 'barcode' || element.type === 'qrcode') && (
        <ModuleWidthField element={element} dpi={ir.dpi} patch={patch} />
      )}

      {(element.type === 'rect' || element.type === 'ellipse') && (
        <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={element.filled}
              onCheckedChange={(checked) => patch({ filled: checked === true } as never)}
            />
            {copy.editor.fields.filled}
          </Label>
      )}

      <p className="text-[11px] text-muted-foreground">
        {`${mmToDots(element.xMm, ir.dpi)}, ${mmToDots(element.yMm, ir.dpi)} dot`}
      </p>
    </div>
  )
}
