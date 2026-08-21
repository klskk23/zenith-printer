/**
 * Grid snapping.
 *
 * Positions snap to whole dots because that is the grid the printer actually
 * has. A horizontal rule that lands on a half dot is smeared across two rows
 * by anti-aliasing and then thinned or removed by thresholding — the renderer
 * already nudges such things onto whole dots, and snapping in the editor makes
 * that grid something the user can feel rather than a correction applied behind
 * their back.
 *
 * Constitution ("Unit convention"): the conversion goes through the canvas's
 * integer dot grid. Converting each element independently from millimetres
 * accumulates error.
 */
import { dotsToMm, layoutGrid, type LayoutGrid } from '@zenith/shared'

export interface SnapContext {
  grid: LayoutGrid
  /** True while the modifier that suspends snapping is held. */
  bypass?: boolean
}

export function gridFor(ir: { widthMm: number; heightMm: number; dpi: number }): LayoutGrid {
  return layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
}

/** Round a millimetre length onto the dot grid. */
export function snapLengthMm(lengthMm: number, context: SnapContext): number {
  if (context.bypass === true) {
    return lengthMm
  }
  const dots = Math.round(context.grid.lengthToDots(lengthMm))
  return dotsToMm(dots, context.grid.dpi)
}

/** Round a point onto the dot grid. Both axes use the same grid. */
export function snapPointMm(
  point: { xMm: number; yMm: number },
  context: SnapContext,
): { xMm: number; yMm: number } {
  return {
    xMm: snapLengthMm(point.xMm, context),
    yMm: snapLengthMm(point.yMm, context),
  }
}

/** Whether the event asks for snapping to be suspended (FR-033). */
export function isSnapBypassed(event: { altKey?: boolean }): boolean {
  return event.altKey === true
}
