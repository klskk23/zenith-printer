/**
 * Where a label falls on the print head — the arithmetic behind the figure.
 *
 * Nothing here draws. Two numbers in, fractions out; the SVG beside this
 * file only scales rectangles by them. The head width comes from the probe
 * (dots at a dpi), converted with the shared `dotsToMm` so this and the
 * server's `maxLabelWidthMm` cannot disagree about what fits.
 */
import { dotsToMm } from '@zenith/shared'

export interface HeadFigure {
  /** How much of the head the label covers, 0–1. */
  labelFraction: number
  /** How much of the *label* hangs off the head, 0–1. Zero when it fits. */
  overflowFraction: number
  /** The overhang in millimetres, to a tenth, for the sentence beside the figure. */
  overflowMm: number
}

export function maxWidthFromCapabilities(
  capabilities: { printheadPixels: number; dpi: number } | null,
): number | null {
  return capabilities === null ? null : dotsToMm(capabilities.printheadPixels, capabilities.dpi)
}

export function headFigure(input: { labelWidthMm: number; maxWidthMm: number | null }): HeadFigure | null {
  const { labelWidthMm, maxWidthMm } = input
  if (maxWidthMm === null || !(maxWidthMm > 0) || !(labelWidthMm > 0)) {
    return null
  }
  if (labelWidthMm <= maxWidthMm) {
    return { labelFraction: labelWidthMm / maxWidthMm, overflowFraction: 0, overflowMm: 0 }
  }
  const over = labelWidthMm - maxWidthMm
  return {
    labelFraction: 1,
    overflowFraction: over / labelWidthMm,
    overflowMm: Math.round(over * 10) / 10,
  }
}
