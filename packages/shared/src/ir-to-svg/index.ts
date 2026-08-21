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
import { barcodeInnerMarkup, renderBarcodeSvg } from '../barcode/index.ts'
import {
  isVariableRef,
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
  /** Module width for barcodes, in dots. Must be even. */
  barcodeModuleWidthDots?: number
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
function transformFor(element: LabelElement, grid: LayoutGrid): string {
  const x = grid.xToDots(element.xMm)
  const y = grid.yToDots(element.yMm)
  if (element.rotation === 0) {
    return `translate(${num(x)} ${num(y)})`
  }
  return `translate(${num(x)} ${num(y)}) rotate(${element.rotation})`
}

function renderText(element: TextElement, grid: LayoutGrid): string {
  const fontSizeDots = grid.lengthToDots(element.fontSizeMm)
  const widthDots = grid.lengthToDots(element.widthMm)
  const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start'
  const anchorX = element.align === 'center' ? widthDots / 2 : element.align === 'right' ? widthDots : 0
  // Baseline sits one em below the top edge, which keeps the visual box the
  // editor draws and the glyphs resvg renders in the same place.
  return [
    `<text x="${num(anchorX)}" y="${num(fontSizeDots)}"`,
    ` font-family="${escapeXml(element.fontFamily)}"`,
    ` font-size="${num(fontSizeDots)}"`,
    ` font-weight="${element.bold ? 'bold' : 'normal'}"`,
    ` text-anchor="${anchor}"`,
    ` fill="#000000"`,
    `>${escapeXml(literal(element.content))}</text>`,
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
      const rendered = renderBarcodeSvg({
        symbology: element.symbology,
        content: literal(element.content),
        heightDots: grid.lengthToDots(element.heightMm),
        moduleWidthDots: options.barcodeModuleWidthDots,
        showHumanReadable: element.showHumanReadable,
      })
      // No scaling: a non-integer scale would undo the whole-dot edge
      // alignment the barcode module works to establish.
      return `<g>${barcodeInnerMarkup(rendered)}</g>`
    }

    case 'qrcode': {
      const size = Math.min(grid.lengthToDots(element.widthMm), grid.lengthToDots(element.heightMm))
      const rendered = renderBarcodeSvg({
        symbology: 'code128',
        content: literal(element.content),
        heightDots: size,
        moduleWidthDots: options.barcodeModuleWidthDots,
        showHumanReadable: false,
      })
      return `<g>${barcodeInnerMarkup(rendered)}</g>`
    }

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

/** Render a fully resolved IR (no variable references left) to SVG. */
export function irToSvg(ir: LabelIR, options: IrToSvgOptions = {}): string {
  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })

  const body = ir.elements
    .map((element) => {
      const markup = renderElement(element, grid, options)
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
