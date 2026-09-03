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
  QRCODE_MODULE_WIDTH_STEP,
  dotsToMm,
  parse,
  mmToDots,
  snapQrcodeModuleWidth,
  type BarcodeElement,
  type LabelElement,
  type LabelIR,
  type QrcodeElement,
  type Rotation,
} from '@zenith/shared'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { copy } from '../i18n/index.ts'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx'
import { FONT_FAMILIES, type FontFamilyKey } from './elements.ts'
import { ROTATIONS } from './rotation.ts'
import { ImageField } from './image-field.tsx'
import { imageBoxMm } from './autofit.ts'
import { symbolBoxMm, symbolFitMm } from './barcode-width.ts'
import { dotStepMm } from './guards.ts'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Input } from '../components/ui/input.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx'

export interface InspectorProps {
  ir: LabelIR
  element: LabelElement | null
  /**
   * Values for `${}` references.
   *
   * A symbol's size is `moduleWidth x moduleCount`, and the count comes from
   * what it will actually encode — so a barcode bound to a column has to be
   * measured against that column's value, exactly as text already is.
   */
  values: Readonly<Record<string, string>>
  /**
   * `mergeKey` names the action, so consecutive edits of one field fold into a
   * single undo entry instead of one per keystroke.
   */
  onChange: (element: LabelElement, mergeKey: string) => void
  onDelete: (id: string) => void
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
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
  disabled = false,
}: {
  value: number
  dpi: number
  onChange: (value: number) => void
  disabled?: boolean
}): React.JSX.Element {
  const step = dotStepMm(dpi)
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        value={Number(value.toFixed(3))}
        step={Number(step.toFixed(3))}
        disabled={disabled}
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
    <div className="flex flex-col gap-1">
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
      <p className="text-2xs text-muted-foreground">{copy.editor.units.dotsSuffix(value, mm)}</p>
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
  values,
  patch,
}: {
  element: BarcodeElement | QrcodeElement
  dpi: number
  values: Readonly<Record<string, string>>
  patch: (changes: Partial<LabelElement>) => void
}): React.JSX.Element {
  const moduleMm = dotsToMm(element.moduleWidthDots, dpi)
  const variable = parse(element.content).some((segment) => segment.kind === 'ref')

  return (
    <div className="flex flex-col gap-1">
      <Field label={copy.editor.moduleWidth}>
        <Input
          type="number"
          min={MIN_MODULE_WIDTH_DOTS}
          // A QR's module width steps in twos; a barcode's in ones. Offering
          // the finer step for a QR offered values it cannot be drawn at, and
          // the renderer rounded them — leaving the frame describing a symbol
          // one module per module smaller than the one inside it.
          step={element.type === 'qrcode' ? QRCODE_MODULE_WIDTH_STEP : 1}
          value={element.moduleWidthDots}
          onChange={(event) => {
            const raw = Math.max(MIN_MODULE_WIDTH_DOTS, Math.round(Number(event.target.value) || MIN_MODULE_WIDTH_DOTS))
            const next = element.type === 'qrcode' ? snapQrcodeModuleWidth(raw) : raw
            // The box follows: a symbol's size *is* moduleWidth x moduleCount,
            // so changing the module width without moving the box leaves the
            // box describing a region the symbol no longer fills.
            const box = symbolBoxMm({ ...element, moduleWidthDots: next }, dpi, values)
            patch({ moduleWidthDots: next, ...(box ?? {}) } as never)
          }}
        />
      </Field>
      <p className="text-2xs text-muted-foreground">
        {copy.editor.moduleWidthHint(element.moduleWidthDots, moduleMm)}
      </p>
      {/*
        The floor is a scanning limit, not a drawing one, and a symbol created
        at the default module width is already sitting on it. Without saying
        so, dragging a new QR code inwards simply does nothing, and there is no
        way to tell a refusal from a broken handle — which is how "it cannot be
        made smaller" came to be reported as a bug.
      */}
      {element.moduleWidthDots <= MIN_MODULE_WIDTH_DOTS && (
        <p className="text-2xs text-muted-foreground">{copy.editor.atMinModuleWidth}</p>
      )}
      {variable && (
        // The module count depends on the content, and the content is not known
        // until print time — so the width shown here is an estimate.
        <p className="text-2xs text-muted-foreground">{copy.editor.variableWidthHint}</p>
      )}
    </div>
  )
}

/**
 * Translate a typed width or height into a change the renderer will honour.
 *
 * For most types the number is taken as given. A barcode's width and a QR
 * code's side are `moduleWidth x moduleCount`, so an arbitrary number is not a
 * size the symbol has: it is rounded to the nearest one that is, and the
 * module width that produces it is written alongside. Without this the fields
 * accepted any value, stored it, and changed nothing on the canvas — the
 * renderer sizes the symbol from the module width and simply capped it against
 * the box.
 */
function sizeChange(
  element: LabelElement,
  change: { widthMm?: number; heightMm?: number },
  dpi: number,
  values: Readonly<Record<string, string>>,
): Partial<LabelElement> {
  if (element.type !== 'barcode' && element.type !== 'qrcode') {
    return change as Partial<LabelElement>
  }
  // A barcode's height is a free choice; only its width is quantised.
  if (change.widthMm === undefined) {
    return element.type === 'barcode' ? (change as Partial<LabelElement>) : {}
  }
  const fitted = symbolFitMm(element, change.widthMm, dpi, values)
  return (fitted === null ? change : fitted) as Partial<LabelElement>
}

export function Inspector({ ir, element, values, onChange, onDelete }: InspectorProps): React.JSX.Element {
  if (element === null) {
    return <p className="text-sm text-muted-foreground">{copy.editor.noSelection}</p>
  }

  /**
   * Apply a change, and say which action it belongs to.
   *
   * The key is built from the fields the *user* touched, before anything
   * derived is folded in — a text element's box is refitted from its content,
   * and keying on the result would make two keystrokes look like two different
   * actions the moment one of them changed the width.
   *
   * Same element, same field, consecutive changes: one undo entry. Typing a
   * part number used to leave one entry per character, so undo deleted letters
   * and a long field pushed everything else out of a fifty-entry history.
   */
  const patch = (changes: Partial<LabelElement>): void => {
    const fields = Object.keys(changes).sort().join(',')
    onChange({ ...element, ...changes } as LabelElement, `${element.id}:${fields}`)
  }

  return (
    // Named so tests can tell an element's width field from the canvas width
    // field in the left column — both are labelled the same way, and a query
    // across the whole document silently picks the wrong one.
    <div className="flex flex-col gap-3" data-inspector>
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
            <MmInput
              value={element.widthMm}
              dpi={ir.dpi}
              onChange={(widthMm) => patch(sizeChange(element, { widthMm }, ir.dpi, values))}
            />
          </Field>
          <Field label={copy.editor.fields.height}>
            <MmInput
              value={element.heightMm}
              dpi={ir.dpi}
              // Disabled for a QR code rather than silently ignored: its side
              // is set by the width field, and a field that accepts a number
              // and discards it is worse than one that says it cannot be used.
              disabled={element.type === 'qrcode'}
              onChange={(heightMm) => patch(sizeChange(element, { heightMm }, ir.dpi, values))}
            />
          </Field>
        </div>
      )}

      {/*
        Rotation, as four buttons rather than a number field.
        `rotationSchema` admits only quarter turns — a free angle resamples a
        barcode onto the dot grid and it stops scanning — so a field that
        accepts 37 would be offering something the label cannot hold. The
        canvas handle does the same thing by dragging; this is the way to set
        it exactly, and the way to see what it currently is.
      */}
      <Field label={copy.editor.fields.rotation}>
        <ToggleGroup
          type="single"
          value={String(element.rotation)}
          onValueChange={(value) => value && patch({ rotation: Number(value) as Rotation })}
        >
          {ROTATIONS.map((degrees) => (
            <ToggleGroupItem
              key={degrees}
              value={String(degrees)}
              aria-label={copy.editor.fields.rotationDegrees(degrees)}
            >
              {copy.editor.fields.rotationDegrees(degrees)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      {/*
        Shown by testing for the field rather than listing the types, so the
        control appears wherever the schema allows it and cannot drift out of
        step with it. Barcodes, QR codes and images have no `inverted`: a
        light-on-dark symbol is refused by many scanners, and for an image the
        same word would mean inverting its pixels.
      */}
      {'inverted' in element && (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={element.inverted}
              onCheckedChange={(checked) => patch({ inverted: checked === true } as never)}
            />
            {copy.editor.fields.inverted}
          </Label>
          <p className="text-2xs text-muted-foreground">{copy.editor.fields.invertedHint}</p>
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
            {element.type === 'text' || element.type === 'qrcode' ? (
              // Multi-line for text, and only where the user typed a newline:
              // the renderer never wraps to the box width, because wrapping
              // needs glyph metrics and the browser's are not the print
              // renderer's, so the two would break at different words.
              //
              // Multi-line for QR codes because a QR code holds bytes, and a
              // newline is a byte like any other — a vCard or a Wi-Fi
              // credential is several lines by definition. A single-line field
              // made those impossible to enter while the encoder handled them
              // perfectly well. A barcode keeps a single-line field: the
              // numeric symbologies cannot carry a newline at all, and a
              // scanner emitting one mid-field is rarely what anyone wanted.
              <Textarea
                // `Field` draws its label as a sibling, so without this the
                // control has no accessible name — nothing to announce it by,
                // and nothing to find it by either.
                aria-label={copy.editor.fields.content}
                rows={3}
                value={element.content}
                onChange={(event) => patch({ content: event.target.value } as never)}
              />
            ) : (
              <Input
                aria-label={copy.editor.fields.content}
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
              onValueChange={(value) => patch({ fontFamily: value } as never)}
            >
              <SelectTrigger aria-label={copy.editor.fields.fontFamily}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => (
                  <SelectItem key={key} value={FONT_FAMILIES[key]}>
                    {copy.editor.fonts[key]}
                  </SelectItem>
                ))}
              </SelectContent>
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
            {/*
              Three mutually exclusive options worth seeing at once. A dropdown
              hides two of the three behind a click and says nothing about what
              the choice is.
            */}
            <Field label={copy.editor.fields.align}>
              <ToggleGroup
                type="single"
                value={element.align}
                onValueChange={(value) => value && patch({ align: value } as never)}
              >
                <ToggleGroupItem value="left" aria-label={copy.editor.align.left} title={copy.editor.align.left}>
                  <AlignLeft className="h-3.5 w-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="center" aria-label={copy.editor.align.center} title={copy.editor.align.center}>
                  <AlignCenter className="h-3.5 w-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="right" aria-label={copy.editor.align.right} title={copy.editor.align.right}>
                  <AlignRight className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
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
              onValueChange={(value) => patch({ symbology: value } as never)}
            >
              <SelectTrigger aria-label={copy.editor.fields.symbology}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['code128', 'code39', 'ean13', 'ean8', 'itf14'].map((symbology) => (
                  <SelectItem key={symbology} value={symbology}>
                    {symbology}
                  </SelectItem>
                ))}
              </SelectContent>
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
        <ModuleWidthField element={element} dpi={ir.dpi} values={values} patch={patch} />
      )}

      {element.type === 'image' && (
        <Field label={copy.editor.fields.image}>
          <ImageField
            element={element}
            onChange={(assetId, natural) =>
              patch({ assetId, ...imageBoxMm(element, natural, ir) } as never)
            }
          />
        </Field>
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

      <p className="text-2xs text-muted-foreground">
        {`${mmToDots(element.xMm, ir.dpi)}, ${mmToDots(element.yMm, ir.dpi)} dot`}
      </p>
    </div>
  )
}
