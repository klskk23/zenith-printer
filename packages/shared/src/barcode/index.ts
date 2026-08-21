/**
 * Barcode rendering — the one place where getting the geometry slightly wrong
 * produces labels that look perfect and cannot be scanned.
 *
 * SC-002 requires a >= 99% read rate. On a 203 dpi thermal head the deciding
 * factor is whether bar edges land on whole dot boundaries: a module width that
 * rounds inconsistently widens some bars and narrows others, and the scanner
 * loses the ratio it decodes from.
 *
 * bwip-js emits its own unit grid where `scale` IS the module width in units.
 * Code 128 draws bars of one to four modules, grouped into one path per width,
 * and each path is stroked down its centre line. So a bar of an odd number of
 * units has edges at half-unit positions. Choosing an even `scale` keeps every
 * bar width even, which keeps every edge on a whole unit — and we then map one
 * unit to exactly one dot.
 *
 * Hence: module width is expressed in dots, must be even, and is handed to
 * bwip-js unchanged.
 */
import bwipjs from 'bwip-js'
import type { BarcodeSymbology } from '../ir/schema.ts'

/** 2 dots at 203 dpi is 0.25 mm, the usual Code 128 X-dimension. */
export const DEFAULT_MODULE_WIDTH_DOTS = 2

const SYMBOLOGY_TO_BCID: Record<BarcodeSymbology, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  ean8: 'ean8',
  itf14: 'itf14',
}

export interface BarcodeRequest {
  symbology: BarcodeSymbology
  content: string
  /** Must be even — see the note above. */
  moduleWidthDots?: number
  heightDots: number
  showHumanReadable?: boolean
}

export interface BarcodeSvg {
  /** SVG markup whose user units map one-to-one onto printer dots. */
  svg: string
  widthDots: number
  heightDots: number
  moduleWidthDots: number
}

export class BarcodeContentError extends Error {
  readonly symbology: BarcodeSymbology
  readonly content: string

  constructor(symbology: BarcodeSymbology, content: string, cause: string) {
    super(`content is not valid for ${symbology}: ${cause}`)
    this.name = 'BarcodeContentError'
    this.symbology = symbology
    this.content = content
  }
}

function assertEvenModuleWidth(moduleWidthDots: number): void {
  if (!Number.isInteger(moduleWidthDots) || moduleWidthDots < 2) {
    throw new Error(`moduleWidthDots must be a whole number of at least 2, received ${moduleWidthDots}`)
  }
  if (moduleWidthDots % 2 !== 0) {
    throw new Error(
      `moduleWidthDots must be even so every bar edge lands on a whole dot, received ${moduleWidthDots}`,
    )
  }
}

function parseViewBox(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('bwip-js produced SVG without a parseable viewBox')
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** Render a barcode to SVG whose user units are printer dots. */
export function renderBarcodeSvg(request: BarcodeRequest): BarcodeSvg {
  const moduleWidthDots = request.moduleWidthDots ?? DEFAULT_MODULE_WIDTH_DOTS
  assertEvenModuleWidth(moduleWidthDots)

  if (request.content.length === 0) {
    throw new BarcodeContentError(request.symbology, request.content, 'content is empty')
  }

  let svg: string
  try {
    svg = bwipjs.toSVG({
      bcid: SYMBOLOGY_TO_BCID[request.symbology],
      text: request.content,
      scale: moduleWidthDots,
      // bwip-js measures height in millimetres at 72dpi internally; we convert
      // from dots so the caller only ever thinks in dots.
      height: (request.heightDots / moduleWidthDots) * (25.4 / 72),
      includetext: request.showHumanReadable ?? false,
      textxalign: 'center',
      paddingwidth: 0,
      paddingheight: 0,
    })
  } catch (err) {
    throw new BarcodeContentError(
      request.symbology,
      request.content,
      err instanceof Error ? err.message : String(err),
    )
  }

  const { width, height } = parseViewBox(svg)
  return { svg, widthDots: width, heightDots: height, moduleWidthDots }
}

/**
 * Strip the outer `<svg>` wrapper so the markup can be nested inside the label.
 * The caller positions it with a translate; no scaling is applied, because a
 * non-integer scale would undo the edge alignment established above.
 */
export function barcodeInnerMarkup(rendered: BarcodeSvg): string {
  return rendered.svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
}
