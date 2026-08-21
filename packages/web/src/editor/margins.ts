/**
 * Margin regions.
 *
 * Drawn, never enforced. A margin says "you may be printing close to the edge
 * here", which is advice about this roll — and someone deliberately printing
 * edge-to-edge has a reason the software does not know. Blocking placement
 * would make the advice into a rule the operator cannot overrule.
 *
 * With no profile chosen there are no margins to draw, and the editor says so
 * rather than showing an unmarked canvas that looks like "no margins".
 */
import type { LayoutGrid } from '@zenith/shared'

export interface Margins {
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
}

export interface MarginBand {
  xDots: number
  yDots: number
  widthDots: number
  heightDots: number
}

/** The four bands, in dots, ready to draw. Empty sides are omitted. */
export function marginBands(margins: Margins, grid: LayoutGrid): MarginBand[] {
  const bands: MarginBand[] = []
  const width = grid.widthDots
  const height = grid.heightDots
  const top = grid.lengthToDots(margins.marginTopMm)
  const right = grid.lengthToDots(margins.marginRightMm)
  const bottom = grid.lengthToDots(margins.marginBottomMm)
  const left = grid.lengthToDots(margins.marginLeftMm)

  if (top > 0) {
    bands.push({ xDots: 0, yDots: 0, widthDots: width, heightDots: top })
  }
  if (bottom > 0) {
    bands.push({ xDots: 0, yDots: height - bottom, widthDots: width, heightDots: bottom })
  }
  // Side bands stop at the horizontal ones so overlapping hatching does not
  // double up and read as a darker, more forbidden-looking corner.
  const sideY = top
  const sideHeight = Math.max(0, height - top - bottom)
  if (left > 0) {
    bands.push({ xDots: 0, yDots: sideY, widthDots: left, heightDots: sideHeight })
  }
  if (right > 0) {
    bands.push({ xDots: width - right, yDots: sideY, widthDots: right, heightDots: sideHeight })
  }

  return bands
}

export function hasAnyMargin(margins: Margins): boolean {
  return (
    margins.marginTopMm > 0 ||
    margins.marginRightMm > 0 ||
    margins.marginBottomMm > 0 ||
    margins.marginLeftMm > 0
  )
}
