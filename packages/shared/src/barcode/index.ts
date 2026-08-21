/**
 * Barcode rendering — the one place where getting the geometry slightly wrong
 * produces labels that look perfect and cannot be scanned.
 *
 * SC-002 requires a >= 99% read rate. On a 203 dpi thermal head the deciding
 * factor is whether bar edges land on whole dot boundaries: a module width that
 * rounds inconsistently widens some bars and narrows others, and the scanner
 * loses the ratio it decodes from.
 *
 * bwip-js emits its own unit grid where `scale` IS the module width in units,
 * and we map one unit to exactly one dot.
 *
 * An earlier version of this file required an *even* module width, reasoning
 * that odd-width bars would be stroked down their centre and so land on half
 * units. That was a measurement error, not a property of the output: bwip-js
 * groups bars into several paths, each with its own `stroke-width`, and the
 * check that produced the rule compared every path against the first path's
 * width. Measured per path, every edge is integral at every whole scale. The
 * rule is gone; the note stays so nobody re-derives it.
 *
 * The real floor is 2 dots, and it comes from scanning rather than drawing: at
 * 203 dpi that is 0.25 mm, the usual Code 128 X-dimension. One dot renders
 * cleanly and simply cannot be read.
 */
import bwipjs from 'bwip-js'
import type { BarcodeSymbology } from '../ir/schema.ts'

/** 2 dots at 203 dpi is 0.25 mm, the usual Code 128 X-dimension. */
export const DEFAULT_MODULE_WIDTH_DOTS = 2

/** Scanning floor, not a drawing limit — see the note at the top of this file. */
export const MIN_MODULE_WIDTH_DOTS = 2

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
  /** Whole dots, at least 2 — see the note above. */
  moduleWidthDots?: number
  heightDots: number
  showHumanReadable?: boolean
}

export interface QrcodeRequest {
  content: string
  /** Whole dots, at least 2. */
  moduleWidthDots?: number
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
}

export interface BarcodeSvg {
  /** SVG markup whose user units map one-to-one onto printer dots. */
  svg: string
  widthDots: number
  heightDots: number
  moduleWidthDots: number
  /**
   * Modules across the symbol. Fixed by the content and the symbology, so the
   * achievable widths are its whole multiples and nothing in between — which
   * is what the editor's resize handle has to snap to.
   */
  moduleCount: number
}

export interface QrcodeSvg extends BarcodeSvg {
  /** Modules per side. A QR symbol is always square. */
  moduleCount: number
}

export class QrcodeContentError extends Error {
  readonly content: string

  constructor(content: string, cause: string) {
    super(`content cannot be encoded as a QR code: ${cause}`)
    this.name = 'QrcodeContentError'
    this.content = content
  }
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

function assertModuleWidth(moduleWidthDots: number): void {
  if (!Number.isInteger(moduleWidthDots) || moduleWidthDots < 2) {
    throw new Error(`moduleWidthDots must be a whole number of at least 2, received ${moduleWidthDots}`)
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
  assertModuleWidth(moduleWidthDots)

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
  return {
    svg,
    widthDots: width,
    heightDots: height,
    moduleWidthDots,
    moduleCount: width / moduleWidthDots,
  }
}

/**
 * Render a QR code to SVG whose user units are printer dots.
 *
 * Separate from `renderBarcodeSvg` because the two have genuinely different
 * shapes: a QR symbol is square, has no human-readable line, and its module
 * count depends on the error-correction level as well as the content.
 */
export function renderQrcodeSvg(request: QrcodeRequest): QrcodeSvg {
  const moduleWidthDots = request.moduleWidthDots ?? DEFAULT_MODULE_WIDTH_DOTS
  assertModuleWidth(moduleWidthDots)

  if (request.content.length === 0) {
    throw new QrcodeContentError(request.content, 'content is empty')
  }

  let svg: string
  try {
    // `eclevel` is a symbology-specific option: bwip-js accepts it at runtime
    // but its RenderOptions type only declares the options common to every
    // symbology. The cast is narrow and the behaviour is covered by tests that
    // assert 'H' produces a larger matrix than 'M'.
    svg = bwipjs.toSVG({
      bcid: 'qrcode',
      text: request.content,
      scale: moduleWidthDots,
      eclevel: request.errorCorrectionLevel ?? 'M',
      paddingwidth: 0,
      paddingheight: 0,
    } as Parameters<typeof bwipjs.toSVG>[0])
  } catch (err) {
    // Overflowing the chosen error-correction level lands here. Refusing beats
    // truncating: a silently shortened payload scans perfectly and says the
    // wrong thing.
    throw new QrcodeContentError(request.content, err instanceof Error ? err.message : String(err))
  }

  const { width, height } = parseViewBox(svg)
  return {
    svg,
    widthDots: width,
    heightDots: height,
    moduleWidthDots,
    moduleCount: width / moduleWidthDots,
  }
}

/**
 * The largest whole multiple of `moduleCount` that fits inside `availableDots`.
 *
 * Barcode and QR sizes are quantised — only whole multiples of the module count
 * exist — so a resize handle has to land on one of them. Rounding *down* keeps
 * the rendered symbol inside the box the element declares (FR-002).
 */
export function fitModuleWidth(availableDots: number, moduleCount: number, minimum = 2): number {
  if (moduleCount <= 0) {
    return minimum
  }
  return Math.max(minimum, Math.floor(availableDots / moduleCount))
}

/** The nearest achievable width, for a handle that snaps rather than clamps. */
export function snapToModuleWidth(targetDots: number, moduleCount: number, minimum = 2): number {
  if (moduleCount <= 0) {
    return minimum
  }
  return Math.max(minimum, Math.round(targetDots / moduleCount))
}

/**
 * Strip the outer `<svg>` wrapper so the markup can be nested inside the label.
 * The caller positions it with a translate; no scaling is applied, because a
 * non-integer scale would undo the edge alignment established above.
 */
export function barcodeInnerMarkup(rendered: BarcodeSvg): string {
  return rendered.svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
}
