/**
 * Grid snapping.
 *
 * Two grids, and they do different jobs.
 *
 * The **dot grid** is the one the print head has. A rule that lands on a half
 * dot is smeared across two rows by anti-aliasing and then thinned or removed
 * by thresholding, so every snapped result ends on a whole dot.
 *
 * The **layout grid** is the one the user aims at, and it is the reason this
 * module was reported as doing nothing. Snapping used to round to whole dots
 * only: at 203 dpi a dot is 0.125 mm — thinner than the line that draws the
 * element — so nothing ever visibly clicked into place and the feature was
 * indistinguishable from free dragging. `SNAP_STEP_MM` is a step you can see
 * and aim for, and the canvas draws it so it is a grid rather than an
 * invisible rule.
 *
 * Constitution ("Unit convention"): the conversion goes through the canvas's
 * integer dot grid. Converting each element independently from millimetres
 * accumulates error.
 */
import { dotsToMm, layoutGrid, type LayoutGrid } from '@zenith/shared'

/**
 * The step the editor snaps to, in millimetres.
 *
 * One millimetre: coarse enough to feel, fine enough that a 50x30 mm label has
 * somewhere to put a 3 mm-high barcode caption. Anything the step cannot
 * express is still reachable — hold Alt to suspend snapping, or type the exact
 * value in the inspector.
 */
export const SNAP_STEP_MM = 1

export interface SnapContext {
  grid: LayoutGrid
  /** True while the modifier that suspends snapping is held. */
  bypass?: boolean
  /** Defaults to `SNAP_STEP_MM`. */
  stepMm?: number
}

export function gridFor(ir: { widthMm: number; heightMm: number; dpi: number }): LayoutGrid {
  return layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
}

/**
 * Round a millimetre length onto the layout grid, then onto the dot grid.
 *
 * In that order: rounding to the millimetre first is what the user sees, and
 * the dot rounding afterwards moves the result by at most half a dot, which is
 * below the resolution of the thing being aimed at.
 */
export function snapLengthMm(lengthMm: number, context: SnapContext): number {
  if (context.bypass === true) {
    return lengthMm
  }
  const step = context.stepMm ?? SNAP_STEP_MM
  const onLayoutGrid = step > 0 ? Math.round(lengthMm / step) * step : lengthMm
  const dots = Math.round(context.grid.lengthToDots(onLayoutGrid))
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
