/**
 * Barcode width is not continuous.
 *
 *     width = moduleWidthDots x moduleCount
 *
 * and the module count is fixed by the content and the symbology — 'ABC-12345'
 * in Code 128 is 123 modules whatever you do to the box. So the achievable
 * widths are whole multiples of that count and nothing in between, and a resize
 * handle has to land on one of them. Dragging to an in-between width and
 * rendering it anyway would mean a non-integer scale, which is exactly what
 * puts bar edges on half dots and stops the symbol scanning.
 *
 * The floor of 2 dots is a scanning limit, not a drawing one: at 203 dpi that
 * is 0.25 mm, the usual Code 128 X-dimension.
 */
import {
  MIN_MODULE_WIDTH_DOTS,
  dotsToMm,
  evaluate,
  mmToDots,
  renderBarcodeSvg,
  renderQrcodeSvg,
  snapQrcodeModuleWidth,
  type BarcodeElement,
  type LabelElement,
  type QrcodeElement,
} from '@zenith/shared'

export interface SnapResult {
  moduleWidthDots: number
  widthDots: number
  widthMm: number
  /** True when the request was below the scanning floor and had to be raised. */
  clampedToFloor: boolean
}

/** The nearest achievable width to what the pointer asked for. */
export function snapWidth(targetMm: number, moduleCount: number, dpi: number): SnapResult {
  const targetDots = mmToDots(targetMm, dpi)
  const raw = moduleCount > 0 ? Math.round(targetDots / moduleCount) : MIN_MODULE_WIDTH_DOTS
  const moduleWidthDots = Math.max(MIN_MODULE_WIDTH_DOTS, raw)
  const widthDots = moduleWidthDots * moduleCount

  return {
    moduleWidthDots,
    widthDots,
    widthMm: dotsToMm(widthDots, dpi),
    clampedToFloor: raw < MIN_MODULE_WIDTH_DOTS,
  }
}

/** The width a given module width produces — for showing the steps. */
export function widthForModule(moduleWidthDots: number, moduleCount: number, dpi: number): number {
  return dotsToMm(moduleWidthDots * moduleCount, dpi)
}

/**
 * The module width that fits a box, rounding **down**.
 *
 * Used where the symbol must not exceed a declared box. Rounding down is what
 * keeps it inside; rounding to nearest would let it spill by up to half a
 * module count.
 */
export function largestModuleWidthWithin(availableMm: number, moduleCount: number, dpi: number): number {
  if (moduleCount <= 0) {
    return MIN_MODULE_WIDTH_DOTS
  }
  const available = mmToDots(availableMm, dpi)
  return Math.max(MIN_MODULE_WIDTH_DOTS, Math.floor(available / moduleCount))
}


/**
 * Content to size a symbol by when the real content is not known yet.
 *
 * A variable-bound symbol has no content until print time, and its module
 * count depends on how long that content turns out to be. Sizing it from a
 * stand-in is an estimate — `copy.editor.variableWidthHint` says so next to
 * the field — but an estimate keeps the box roughly the size of the symbol,
 * where refusing to size it at all leaves the box wherever it was last.
 */
const SAMPLE_CONTENT = 'SAMPLE'

/**
 * How many modules this symbol has.
 *
 * Fixed by the content and the symbology; the module width does not enter into
 * it. Returns null for content the symbology cannot encode — the guards report
 * that separately, and resizing the box to nothing on a typo would be a second
 * complaint about the same thing.
 */
export function moduleCountOf(
  element: BarcodeElement | QrcodeElement,
  /** Values for `${}` references, so the count reflects what will be encoded. */
  values: Readonly<Record<string, string>> = {},
): number | null {
  // A reference with no value yet is measured against a stand-in rather than
  // against the empty string: an unwritten variable should leave a box the
  // right sort of size, not collapse it to nothing.
  const evaluated = evaluate(element.content, values)
  const content = evaluated.unresolved.length > 0 || evaluated.text.length === 0
    ? SAMPLE_CONTENT
    : evaluated.text
  try {
    if (element.type === 'qrcode') {
      return renderQrcodeSvg({
        content,
        moduleWidthDots: element.moduleWidthDots,
        errorCorrectionLevel: element.errorCorrectionLevel,
      }).moduleCount
    }
    return renderBarcodeSvg({
      symbology: element.symbology,
      content,
      heightDots: 10,
      moduleWidthDots: element.moduleWidthDots,
    }).moduleCount
  } catch {
    return null
  }
}

/**
 * The box that matches what the renderer will actually draw.
 *
 * A symbol's size is `moduleWidth x moduleCount` and nothing else — the
 * declared box does not stretch it. So the box has to be kept equal to that
 * product, or it describes a region the symbol does not fill: a QR code at the
 * default module width is about 6 mm across inside the 15 mm square it is
 * created with, and enlarging that square did nothing at all, because the
 * renderer takes the *smaller* of the box and the module width.
 *
 * A barcode's height is free — it is a free choice, not a consequence of the
 * content — so only its width is returned. A QR code is square by definition.
 */
export function symbolBoxMm(
  element: BarcodeElement | QrcodeElement,
  dpi: number,
  /**
   * Values for `${}` references, so the box matches what will be encoded.
   *
   * Without them a symbol bound to a column was measured against the stand-in,
   * and the frame on the canvas described a symbol nobody was going to print.
   * Text has been measured against its resolved content since boxes were made
   * to follow content; these two were left behind because the values never
   * reached them.
   */
  values: Readonly<Record<string, string>> = {},
): { widthMm: number; heightMm?: number } | null {
  const moduleCount = moduleCountOf(element, values)
  if (moduleCount === null) {
    return null
  }
  const moduleWidthDots = effectiveModuleWidth(element)
  const sideMm = widthForModule(moduleWidthDots, moduleCount, dpi)
  return element.type === 'qrcode' ? { widthMm: sideMm, heightMm: sideMm } : { widthMm: sideMm }
}

/**
 * The module width the renderer will actually use.
 *
 * A QR's comes in even dots — see `QRCODE_MODULE_WIDTH_STEP` — and the
 * renderer rounds an odd one on the way in. Computing a box from the odd value
 * therefore describes a symbol nobody will draw: the frame came out one module
 * per module short of the code inside it.
 */
function effectiveModuleWidth(element: BarcodeElement | QrcodeElement): number {
  return element.type === 'qrcode'
    ? snapQrcodeModuleWidth(element.moduleWidthDots)
    : element.moduleWidthDots
}

/**
 * The module width and box that come closest to a requested size.
 *
 * The inverse of `symbolBoxMm`: the user drags a handle or types a width, and
 * this answers with the nearest size the symbology can actually produce, along
 * with the module width that produces it.
 */
export function symbolFitMm(
  element: BarcodeElement | QrcodeElement,
  targetMm: number,
  dpi: number,
  /** Values for `${}` references: the achievable widths are multiples of the
   *  module count, and that count comes from what will actually be encoded. */
  values: Readonly<Record<string, string>> = {},
): { moduleWidthDots: number; widthMm: number; heightMm?: number } | null {
  const moduleCount = moduleCountOf(element, values)
  if (moduleCount === null) {
    return null
  }
  const snapped = snapWidth(targetMm, moduleCount, dpi)
  if (element.type !== 'qrcode') {
    return { moduleWidthDots: snapped.moduleWidthDots, widthMm: snapped.widthMm }
  }
  // Snapped twice: once onto a whole number of modules, then onto the even
  // module widths a QR can actually be drawn at.
  const moduleWidthDots = snapQrcodeModuleWidth(snapped.moduleWidthDots)
  const sideMm = widthForModule(moduleWidthDots, moduleCount, dpi)
  return { moduleWidthDots, widthMm: sideMm, heightMm: sideMm }
}


/**
 * Turn a new size into the change that actually resizes the element.
 *
 * For most types the size *is* the change. For a symbol it is not: the
 * renderer draws `moduleWidth x moduleCount` and takes the smaller of that and
 * the declared box, so writing only a width leaves the box growing around a
 * symbol that stays exactly where it was. That is what a resize drag did — the
 * handle moved, the frame followed, and the code did not.
 *
 * A barcode keeps whatever height the drag asked for; its height is a free
 * choice rather than a consequence of its content.
 */
export function resizePatchFor(
  element: LabelElement,
  size: { widthMm: number; heightMm: number },
  dpi: number,
  values: Readonly<Record<string, string>> = {},
): Partial<LabelElement> {
  if (element.type !== 'barcode' && element.type !== 'qrcode') {
    return size as Partial<LabelElement>
  }
  const fitted = symbolFitMm(element, size.widthMm, dpi, values)
  if (fitted === null) {
    return size as Partial<LabelElement>
  }
  return (
    element.type === 'barcode' ? { ...fitted, heightMm: size.heightMm } : fitted
  ) as Partial<LabelElement>
}
