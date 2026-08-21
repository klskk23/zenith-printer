/**
 * Label IR -> SVG.
 *
 * This module is the single guarantee that the editor preview and the printed
 * label agree. The frontend drops the output straight into the DOM; the backend
 * hands the identical string to resvg. Whatever differences remain come only
 * from "SVG -> pixels", never from "IR -> SVG".
 *
 * Two properties matter and are enforced by tests:
 *
 *   1. The viewBox is expressed in DOTS, not millimetres, so one SVG user unit
 *      is one printer dot. Horizontal and vertical rules can then be placed on
 *      exact pixel rows instead of being smeared across two.
 *   2. Output is byte-for-byte deterministic. Attribute order is fixed and
 *      numbers are formatted through one helper, because SC-010 requires the
 *      same template to render identically after a redeploy.
 */
import {
  BarcodeContentError,
  MIN_MODULE_WIDTH_DOTS,
  QrcodeContentError,
  barcodeInnerMarkup,
  fitModuleWidth,
  renderBarcodeSvg,
  renderQrcodeSvg,
} from '../barcode/index.ts'
import {
  isVariableRef,
  type EllipseElement,
  type LabelElement,
  type LabelIR,
  type LineElement,
  type RectElement,
  type TextElement,
} from '../ir/schema.ts'
import { layoutGrid, type LayoutGrid } from '../units.ts'

export interface IrToSvgOptions {
  /**
   * Resolve an image asset id to something an `<image href>` can load —
   * a data URI on the backend, a blob or API URL in the browser.
   * Unresolved images are skipped rather than failing the whole render.
   */
  resolveImage?: (assetId: string) => string | undefined

  /**
   * Draw what can be drawn and leave out what cannot, instead of failing the
   * whole render.
   *
   * For the **editor** only. Content is edited a keystroke at a time, and
   * several of those keystrokes pass through states no symbology can encode —
   * an empty QR code, a half-typed EAN-13. Throwing on those took the entire
   * page down with it, because the editor renders inside React's render pass:
   * clearing a QR code's content blanked the whole application. The element is
   * omitted, the guards go on reporting exactly why, and the rest of the label
   * stays visible and editable.
   *
   * Never for **printing**. A label that quietly comes out missing its barcode
   * is worse than a job that refuses to start, so the print path leaves this
   * off and takes the exception.
   */
  skipUnrenderable?: boolean
}

export class UnresolvedVariableError extends Error {
  readonly fieldName: string

  constructor(fieldName: string) {
    super(`element still references variable "${fieldName}"; call resolveVariables first`)
    this.name = 'UnresolvedVariableError'
    this.fieldName = fieldName
  }
}

/**
 * Fixed-precision number formatting. Without this, platform differences in
 * float-to-string turn into diffs in the rendered output.
 */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function literal(content: string | { $var: string }): string {
  if (isVariableRef(content)) {
    throw new UnresolvedVariableError(content.$var)
  }
  return content
}

/** Rotation about the element's own top-left corner. */
/** Centre of the element's own, unrotated box — in absolute dots. */
function rotationCentreDots(
  element: LabelElement,
  grid: LayoutGrid,
): { x: number; y: number } {
  if (element.type === 'line') {
    // Signed spans, so a line drawn right-to-left still centres on its middle.
    return {
      x: grid.xToDots(element.xMm) + grid.lengthToDots(element.x2Mm - element.xMm) / 2,
      y: grid.yToDots(element.yMm) + grid.lengthToDots(element.y2Mm - element.yMm) / 2,
    }
  }
  return {
    x: grid.xToDots(element.xMm) + grid.lengthToDots(element.widthMm) / 2,
    y: grid.yToDots(element.yMm) + grid.lengthToDots(element.heightMm) / 2,
  }
}

/**
 * Where an element is placed, and about which point it turns.
 *
 * Rotation is about the element's own centre. It used to be
 * `translate(x y) rotate(deg)`, which turns about the top-left corner and so
 * throws the element clear of the box it is meant to occupy — a quarter turn
 * moved it a full height sideways. Both the editor's selection frame and the
 * pre-print overflow check measure with `rotatedBounds`, which is centre-based,
 * so the renderer was the odd one out: the frame sat where the element wasn't,
 * and overflow was judged against a region nothing was drawn in.
 */
function transformFor(element: LabelElement, grid: LayoutGrid): string {
  const x = grid.xToDots(element.xMm)
  const y = grid.yToDots(element.yMm)
  const place = `translate(${num(x)} ${num(y)})`
  if (element.rotation === 0) {
    return place
  }
  const centre = rotationCentreDots(element, grid)
  // Applied right to left: the geometry is placed, then turned about a point
  // expressed in the label's own coordinates.
  return `rotate(${element.rotation} ${num(centre.x)} ${num(centre.y)}) ${place}`
}

/**
 * Line spacing, as a multiple of the font size.
 *
 * A constant rather than a field. Made configurable it would have to be
 * interpreted identically by the browser and by resvg, and every knob that
 * both sides must agree on is another way for them to disagree.
 */
export const TEXT_LINE_HEIGHT = 1.2

/**
 * Split text into lines.
 *
 * Explicit newlines only — no wrapping to the box width. Wrapping needs the
 * advance width of every glyph, and the browser's metrics and resvg's are not
 * identical, so the same text and the same box would break at different words
 * on the two sides. The editor would show three lines and the printer would
 * produce four, with the last one outside the box. Splitting on a character is
 * the only rule both sides can carry out identically.
 */
export function textLines(content: string): string[] {
  return content.split('\n')
}

function renderText(element: TextElement, grid: LayoutGrid): string {
  const fontSizeDots = grid.lengthToDots(element.fontSizeMm)
  const widthDots = grid.lengthToDots(element.widthMm)
  const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start'
  const anchorX = element.align === 'center' ? widthDots / 2 : element.align === 'right' ? widthDots : 0
  const lineHeightDots = Math.round(fontSizeDots * TEXT_LINE_HEIGHT)
  const lines = textLines(literal(element.content))

  // Every line is positioned absolutely. `dy` would work in resvg — measured
  // pixel-identical — but it makes each line's position depend on the
  // renderer's accumulation of the previous one. Absolute y is a constant both
  // sides compute the same way.
  const spans = lines
    .map((line, index) => {
      const y = fontSizeDots + index * lineHeightDots
      return `<tspan x="${num(anchorX)}" y="${num(y)}">${escapeXml(line)}</tspan>`
    })
    .join('')

  // Baseline sits one em below the top edge, which keeps the visual box the
  // editor draws and the glyphs resvg renders in the same place.
  return [
    `<text`,
    ` font-family="${escapeXml(element.fontFamily)}"`,
    ` font-size="${num(fontSizeDots)}"`,
    ` font-weight="${element.bold ? 'bold' : 'normal'}"`,
    ` text-anchor="${anchor}"`,
    ` fill="#000000"`,
    `>${spans}</text>`,
  ].join('')
}

function renderLine(element: LineElement, grid: LayoutGrid): string {
  const x1 = 0
  const y1 = 0
  const x2 = grid.lengthToDots(element.x2Mm - element.xMm)
  const y2 = grid.lengthToDots(element.y2Mm - element.yMm)
  const width = element.strokeWidthDots

  // Snap axis-aligned rules onto a whole pixel row or column. A stroke of odd
  // width is centred on its path, so its edges land on half dots unless the
  // centre line is offset by half a dot.
  const halfDotOffset = width % 2 === 1 ? 0.5 : 0
  const isHorizontal = y1 === y2
  const isVertical = x1 === x2

  const oy = isHorizontal ? halfDotOffset : 0
  const ox = isVertical ? halfDotOffset : 0

  return (
    `<line x1="${num(x1 + ox)}" y1="${num(y1 + oy)}"` +
    ` x2="${num(x2 + ox)}" y2="${num(y2 + oy)}"` +
    ` stroke="#000000" stroke-width="${num(width)}" stroke-linecap="butt"/>`
  )
}

function renderRect(element: RectElement, grid: LayoutGrid): string {
  const w = grid.lengthToDots(element.widthMm)
  const h = grid.lengthToDots(element.heightMm)
  const radius = grid.lengthToDots(element.cornerRadiusMm)

  if (element.filled) {
    return (
      `<rect x="0" y="0" width="${num(w)}" height="${num(h)}"` +
      (radius > 0 ? ` rx="${num(radius)}" ry="${num(radius)}"` : '') +
      ` fill="#000000"/>`
    )
  }

  // Outlined rectangles are centre-stroked too; inset by half the stroke so the
  // outer edge coincides with the declared box.
  const inset = element.strokeWidthDots / 2
  return (
    `<rect x="${num(inset)}" y="${num(inset)}"` +
    ` width="${num(Math.max(0, w - element.strokeWidthDots))}"` +
    ` height="${num(Math.max(0, h - element.strokeWidthDots))}"` +
    (radius > 0 ? ` rx="${num(radius)}" ry="${num(radius)}"` : '') +
    ` fill="none" stroke="#000000" stroke-width="${num(element.strokeWidthDots)}"/>`
  )
}

/**
 * Ellipses mirror rectangles: centre-stroked, inset by half the stroke so the
 * outer edge coincides with the declared box.
 *
 * A stroke at least as wide as the minor axis leaves no hole to draw, so the
 * shape becomes solid. That is treated as the natural result of "the stroke got
 * wide enough to fill it" rather than an error, and the user's number is left
 * exactly as they typed it (FR-085).
 */
function renderEllipse(element: EllipseElement, grid: LayoutGrid): string {
  const w = grid.lengthToDots(element.widthMm)
  const h = grid.lengthToDots(element.heightMm)
  const cx = w / 2
  const cy = h / 2

  if (element.filled || element.strokeWidthDots * 2 >= Math.min(w, h)) {
    return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(w / 2)}" ry="${num(h / 2)}" fill="#000000"/>`
  }

  const inset = element.strokeWidthDots / 2
  return (
    `<ellipse cx="${num(cx)}" cy="${num(cy)}"` +
    ` rx="${num(Math.max(0, w / 2 - inset))}" ry="${num(Math.max(0, h / 2 - inset))}"` +
    ` fill="none" stroke="#000000" stroke-width="${num(element.strokeWidthDots)}"/>`
  )
}

function renderElement(
  element: LabelElement,
  grid: LayoutGrid,
  options: IrToSvgOptions,
): string | undefined {
  switch (element.type) {
    case 'text':
      return renderText(element, grid)

    case 'line':
      return renderLine(element, grid)

    case 'rect':
      return renderRect(element, grid)

    case 'barcode': {
      // Module width is the element's own property. It used to be a single
      // render-wide option, which meant two barcodes on one label could not
      // differ and the element's declared width did nothing at all.
      const rendered = renderBarcodeSvg({
        symbology: element.symbology,
        content: literal(element.content),
        heightDots: grid.lengthToDots(element.heightMm),
        moduleWidthDots: element.moduleWidthDots,
        showHumanReadable: element.showHumanReadable,
      })
      // No scaling: a non-integer scale would undo the whole-dot edge
      // alignment the barcode module works to establish.
      return `<g>${barcodeInnerMarkup(rendered)}</g>`
    }

    case 'qrcode': {
      // This used to ask for a Code 128 barcode of the same content. The output
      // looked like a plausible barcode, so nothing failed loudly — it simply
      // was not a QR code, and it was far wider than the element declaring it.
      const declared = Math.min(grid.lengthToDots(element.widthMm), grid.lengthToDots(element.heightMm))

      // A QR side is moduleWidth x moduleCount, so only whole multiples exist.
      // Probe once at the element's own width to learn the module count, then
      // pick the largest multiple that still fits the declared box (FR-002).
      const probe = renderQrcodeSvg({
        content: literal(element.content),
        moduleWidthDots: element.moduleWidthDots,
        errorCorrectionLevel: element.errorCorrectionLevel,
      })
      const moduleWidthDots = Math.min(
        element.moduleWidthDots,
        fitModuleWidth(declared, probe.moduleCount, MIN_MODULE_WIDTH_DOTS),
      )

      const rendered =
        moduleWidthDots === probe.moduleWidthDots
          ? probe
          : renderQrcodeSvg({
              content: literal(element.content),
              moduleWidthDots,
              errorCorrectionLevel: element.errorCorrectionLevel,
            })

      return `<g>${barcodeInnerMarkup(rendered)}</g>`
    }

    case 'ellipse':
      return renderEllipse(element, grid)

    case 'image': {
      const href = options.resolveImage?.(element.assetId)
      if (href === undefined) {
        return undefined
      }
      const w = grid.lengthToDots(element.widthMm)
      const h = grid.lengthToDots(element.heightMm)
      const preserve =
        element.fit === 'fill' ? 'none' : element.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
      return (
        `<image x="0" y="0" width="${num(w)}" height="${num(h)}"` +
        ` preserveAspectRatio="${preserve}" href="${escapeXml(href)}"/>`
      )
    }
  }
}

/**
 * Render one element, honouring `skipUnrenderable`.
 *
 * Only content errors are swallowed, and only when asked. Anything else — a
 * bug in this module, a malformed grid — still propagates, because a blank
 * element where a rectangle should be is a defect worth seeing.
 */
function renderUnlessSkippable(
  element: LabelElement,
  grid: LayoutGrid,
  options: IrToSvgOptions,
): string | undefined {
  if (options.skipUnrenderable !== true) {
    return renderElement(element, grid, options)
  }
  try {
    return renderElement(element, grid, options)
  } catch (error) {
    if (error instanceof QrcodeContentError || error instanceof BarcodeContentError) {
      return undefined
    }
    throw error
  }
}

/** Render a fully resolved IR (no variable references left) to SVG. */
export function irToSvg(ir: LabelIR, options: IrToSvgOptions = {}): string {
  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })

  const body = ir.elements
    .map((element) => {
      const markup = renderUnlessSkippable(element, grid, options)
      return markup === undefined
        ? undefined
        : `<g transform="${transformFor(element, grid)}">${markup}</g>`
    })
    .filter((markup): markup is string => markup !== undefined)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${grid.widthDots}" height="${grid.heightDots}"` +
    ` viewBox="0 0 ${grid.widthDots} ${grid.heightDots}"` +
    `><rect x="0" y="0" width="${grid.widthDots}" height="${grid.heightDots}" fill="#ffffff"/>` +
    `${body}</svg>`
  )
}

export { layoutGrid }
