/**
 * Rotation-aware geometry.
 *
 * Shared rather than frontend-only on purpose: the same answer is needed by the
 * editor's live overflow hint and by the pre-print check that runs over every
 * label. Two implementations would drift, and the drift would surface as "the
 * editor said it was fine but printing says it overflows".
 *
 * Rotation is locked to right angles (FR-035), which reduces this to swapping
 * width and height — no rotation matrix, no general bounding-box solve.
 */
import type { Rotation } from '../ir/schema.ts'

export interface Box {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

/**
 * The axis-aligned box an element occupies once rotated.
 *
 * The element turns about its own centre, so the centre is what stays put and
 * the corner is recomputed from the new extents.
 */
export function rotatedBounds(element: Box & { rotation?: Rotation }): Box {
  const { xMm, yMm, widthMm, heightMm } = element
  const quarterTurn = element.rotation === 90 || element.rotation === 270

  if (!quarterTurn) {
    return { xMm, yMm, widthMm, heightMm }
  }

  const centreX = xMm + widthMm / 2
  const centreY = yMm + heightMm / 2

  return {
    xMm: centreX - heightMm / 2,
    yMm: centreY - widthMm / 2,
    widthMm: heightMm,
    heightMm: widthMm,
  }
}
