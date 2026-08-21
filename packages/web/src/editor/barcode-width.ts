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
import { MIN_MODULE_WIDTH_DOTS, dotsToMm, mmToDots } from '@zenith/shared'

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
