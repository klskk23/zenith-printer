/**
 * Fitting an element's box to what is actually drawn in it.
 *
 * Both element types here declare a box that the renderer does not derive from
 * the content, so the box and the content drift apart the moment the content
 * changes:
 *
 *   - **text** is drawn at `fontSizeMm`, from a baseline one em below the box's
 *     top edge. `heightMm` has no effect on the rendering at all, and
 *     `widthMm` only positions the anchor for centred and right-aligned text.
 *     A new text element is 30x5 mm holding about 6x3 mm of glyphs.
 *   - **image** is letterboxed into its box by `preserveAspectRatio`. A 16:9
 *     screenshot dropped into the default 15x15 mm square is drawn as a strip
 *     across the middle with empty box above and below it.
 *
 * In both cases the selection frame, the overflow check and the layers panel
 * all describe a region much larger than the ink — so the editor reports an
 * element overflowing the label when nothing visible is near the edge.
 *
 * Measuring glyphs in the browser is deliberate and bounded. The renderer
 * refuses to use browser metrics to decide *line breaks*, because the browser
 * and resvg would break the same sentence at different words and the preview
 * would stop matching the print. A box is not a line break: it changes where
 * an anchor sits, never which glyphs are drawn, so a box a fraction of a
 * millimetre off produces the same printed label.
 */
import {
  TEXT_LINE_HEIGHT,
  textLines,
  type LabelElement,
  type LabelIR,
  type TextElement,
} from '@zenith/shared'
import { symbolBoxMm } from './barcode-width.ts'

export interface Box {
  widthMm: number
  heightMm: number
}

/**
 * Width of one line at one millimetre of font size.
 *
 * Injected so the rule can be tested without a browser, and so the one place
 * that touches the DOM stays a single function.
 */
export interface LineWidthMeasurer {
  (line: string, element: TextElement): number
}

/** Never collapse to nothing: a zero-width box cannot be selected or grabbed. */
const MIN_EXTENT_MM = 0.5

/**
 * The box that fits a text element's own glyphs.
 *
 * Height is not measured — it is the renderer's own arithmetic. The first
 * baseline sits one em below the top edge and each further line is
 * `TEXT_LINE_HEIGHT` ems below the last, so the extent follows from the font
 * size and the line count and agrees with the print exactly.
 */
export function textBoxMm(element: TextElement, measure: LineWidthMeasurer): Box {
  const lines = textLines(typeof element.content === 'string' ? element.content : '')
  const perMm = Math.max(...lines.map((line) => measure(line, element)), 0)

  return {
    widthMm: Math.max(MIN_EXTENT_MM, perMm * element.fontSizeMm),
    heightMm: Math.max(
      MIN_EXTENT_MM,
      element.fontSizeMm * (1 + TEXT_LINE_HEIGHT * (lines.length - 1)),
    ),
  }
}

/** True when a change to `next` makes the fitted box different from `previous`'s. */
export function affectsTextBox(previous: TextElement, next: TextElement): boolean {
  return (
    previous.content !== next.content ||
    previous.fontSizeMm !== next.fontSizeMm ||
    previous.fontFamily !== next.fontFamily ||
    previous.bold !== next.bold
  )
}

export interface NaturalSize {
  width: number
  height: number
}

/**
 * The box an image fills edge to edge.
 *
 * The current width is kept and the height follows from the picture's own
 * proportions — one rule for a fresh paste and for replacing the file behind
 * an element the user has already sized. The result is clamped to the label so
 * that pasting a tall photo does not produce an element taller than the paper.
 */
export function imageBoxMm(current: Box, natural: NaturalSize, ir: LabelIR): Box {
  // Rebuilt rather than returned as given. Callers pass a whole element and
  // spread the result over it, so handing `current` straight back spreads
  // every other field of the element back over itself — including the assetId
  // that had just been set, which is how a successful upload managed to leave
  // the element still pointing at nothing.
  if (natural.width <= 0 || natural.height <= 0) {
    return { widthMm: current.widthMm, heightMm: current.heightMm }
  }
  const ratio = natural.width / natural.height
  let widthMm = Math.max(MIN_EXTENT_MM, current.widthMm)
  let heightMm = Math.max(MIN_EXTENT_MM, widthMm / ratio)

  if (heightMm > ir.heightMm) {
    heightMm = ir.heightMm
    widthMm = heightMm * ratio
  }
  if (widthMm > ir.widthMm) {
    widthMm = ir.widthMm
    heightMm = widthMm / ratio
  }
  return { widthMm, heightMm }
}

/**
 * Measure glyph advance with a 2D canvas context.
 *
 * Measured at a reference size and divided by it, so the caller multiplies by
 * whatever font size the element uses — one measurement serves every size, and
 * the result is expressed per millimetre of font size rather than in pixels,
 * which keeps device pixel ratio and zoom out of it entirely.
 *
 * Returns a rough estimate where no canvas is available (server rendering,
 * tests) rather than throwing: a box from an estimate is closer to the truth
 * than the declared box this replaces.
 */
const REFERENCE_PX = 100

export function canvasLineWidth(line: string, element: TextElement): number {
  const context = measurementContext()
  if (context === null) {
    // Half an em per character: near enough for Latin text, and the box is
    // recomputed the moment a real context exists.
    return line.length * 0.5
  }
  context.font = `${element.bold ? 'bold ' : ''}${REFERENCE_PX}px ${element.fontFamily}`
  return context.measureText(line).width / REFERENCE_PX
}

let cached: CanvasRenderingContext2D | null | undefined

function measurementContext(): CanvasRenderingContext2D | null {
  if (cached === undefined) {
    cached =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return cached
}


/**
 * Whether a change to a symbol makes the box it declares wrong.
 *
 * The module count comes from the content and the symbology, and the side from
 * the module count and the module width — so all four move the box. Position
 * and rotation do not.
 */
function affectsSymbolBox(previous: LabelElement, next: LabelElement): boolean {
  if (previous.type !== next.type) {
    return true
  }
  if (next.type === 'qrcode' && previous.type === 'qrcode') {
    return (
      previous.content !== next.content ||
      previous.moduleWidthDots !== next.moduleWidthDots ||
      previous.errorCorrectionLevel !== next.errorCorrectionLevel
    )
  }
  if (next.type === 'barcode' && previous.type === 'barcode') {
    return (
      previous.content !== next.content ||
      previous.moduleWidthDots !== next.moduleWidthDots ||
      previous.symbology !== next.symbology
    )
  }
  return false
}

/**
 * Bring an element's declared box back in line with what will be drawn in it.
 *
 * One entry point for every type whose content decides its own size, so that
 * adding such a type is a case here rather than another edit scattered through
 * the editor. `previous` is null for a newly created element, which always
 * needs fitting.
 *
 * Types whose box genuinely is a free choice — rectangles, lines, images after
 * their proportions are set — are returned untouched.
 */
export function refit(previous: LabelElement | null, next: LabelElement, dpi: number): LabelElement {
  if (next.type === 'text') {
    if (previous !== null && (previous.type !== 'text' || !affectsTextBox(previous, next))) {
      return next
    }
    return { ...next, ...textBoxMm(next, canvasLineWidth) }
  }

  if (next.type === 'qrcode' || next.type === 'barcode') {
    if (previous !== null && !affectsSymbolBox(previous, next)) {
      return next
    }
    const box = symbolBoxMm(next, dpi)
    // Null means the content cannot be encoded. The guards report that; the
    // box is left where it was rather than collapsing mid-keystroke.
    return box === null ? next : { ...next, ...box }
  }

  return next
}
