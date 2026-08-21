/**
 * Millimetre / dot conversion — the single implementation in the project.
 *
 * Constitution ("Unit convention"):
 *   - coordinates and sizes are stored in millimetres
 *   - `dot = round(mm * dpi / 25.4)`, always `round`, never `floor`
 *   - the canvas is converted to whole dots first, and element coordinates are
 *     derived from that dot grid rather than converted individually
 *
 * The last rule is the subtle one. Converting each element straight from
 * millimetres lets rounding error accumulate, so an element near the right edge
 * can land two or three dots short of where the design put it.
 */

const MM_PER_INCH = 25.4

/** Resolution of both currently supported printers (B3S_P and PC310T 203dpi). */
export const DEFAULT_DPI = 203

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, received ${value}`)
  }
}

function assertDpi(dpi: number): void {
  assertFinite(dpi, 'dpi')
  if (dpi <= 0) {
    throw new Error(`dpi must be greater than zero, received ${dpi}`)
  }
}

/** Convert millimetres to whole dots. Rounds — see the note above. */
export function mmToDots(mm: number, dpi: number): number {
  assertFinite(mm, 'mm')
  assertDpi(dpi)
  return Math.round((mm * dpi) / MM_PER_INCH)
}

/** Convert dots back to millimetres. */
export function dotsToMm(dots: number, dpi: number): number {
  assertFinite(dots, 'dots')
  assertDpi(dpi)
  return (dots * MM_PER_INCH) / dpi
}

/**
 * Snap a millimetre coordinate onto the dot grid.
 *
 * Horizontal and vertical rules must land on a whole pixel row. A rule that
 * straddles two rows is smeared across both by anti-aliasing, and thresholding
 * then turns it into two faint lines or removes it entirely.
 */
export function snapToDotGrid(mm: number, dpi: number): number {
  return dotsToMm(mmToDots(mm, dpi), dpi)
}

export interface CanvasSpec {
  widthMm: number
  heightMm: number
  dpi: number
}

export interface LayoutGrid {
  readonly dpi: number
  readonly widthDots: number
  readonly heightDots: number
  readonly widthMm: number
  readonly heightMm: number
  /** Smallest stroke width that still produces a visible mark (FR-008). */
  readonly minStrokeWidthMm: number
  /** Map a millimetre x-coordinate onto the canvas dot grid, clamped. */
  xToDots(mm: number): number
  /** Map a millimetre y-coordinate onto the canvas dot grid, clamped. */
  yToDots(mm: number): number
  /** Map a millimetre length onto whole dots, with no clamping. */
  lengthToDots(mm: number): number
}

/**
 * Build the layout grid for a canvas. Element coordinates must be resolved
 * through the returned helpers rather than by calling `mmToDots` directly.
 */
export function layoutGrid(spec: CanvasSpec): LayoutGrid {
  const { widthMm, heightMm, dpi } = spec
  assertFinite(widthMm, 'widthMm')
  assertFinite(heightMm, 'heightMm')
  assertDpi(dpi)

  if (widthMm <= 0 || heightMm <= 0) {
    throw new Error(`canvas must have positive dimensions, received ${widthMm}x${heightMm}mm`)
  }

  const widthDots = mmToDots(widthMm, dpi)
  const heightDots = mmToDots(heightMm, dpi)

  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max)

  return {
    dpi,
    widthDots,
    heightDots,
    widthMm,
    heightMm,
    minStrokeWidthMm: MM_PER_INCH / dpi,
    xToDots: (mm) => clamp(mmToDots(mm, dpi), widthDots),
    yToDots: (mm) => clamp(mmToDots(mm, dpi), heightDots),
    lengthToDots: (mm) => mmToDots(mm, dpi),
  }
}
