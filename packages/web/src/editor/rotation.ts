/**
 * Right-angle rotation.
 *
 * Locked to quarter turns (FR-035). Free rotation would need bounding boxes
 * solved from a rotation matrix, and — more to the point — a barcode at 37
 * degrees is resampled onto the dot grid and stops scanning. Quarter turns map
 * whole dots onto whole dots.
 */
import type { Rotation } from '@zenith/shared'

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

/** Normalise any angle onto the nearest quarter turn. */
export function snapRotation(degrees: number): Rotation {
  const wrapped = ((degrees % 360) + 360) % 360
  const quarter = Math.round(wrapped / 90) % 4
  return ROTATIONS[quarter]!
}

/** The angle from an element's centre to a pointer, in degrees clockwise from up. */
export function angleFromCentre(
  centre: { x: number; y: number },
  pointer: { x: number; y: number },
): number {
  const dx = pointer.x - centre.x
  const dy = pointer.y - centre.y
  // Screen y grows downwards, so "up" is -y; measuring from there keeps 0 at
  // the top where the handle sits.
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/** Next quarter turn clockwise — what a rotate button does. */
export function rotateClockwise(current: Rotation): Rotation {
  return ROTATIONS[(ROTATIONS.indexOf(current) + 1) % ROTATIONS.length]!
}
