/**
 * Four direction inputs over two signed values.
 *
 * Someone who has just reloaded a roll perceives the fault as "it printed too
 * high", so the controls read up / right / down / left. Storage keeps two
 * signed numbers, which is what makes the contradictory state — up 2 *and*
 * down 3 — inexpressible rather than merely discouraged.
 *
 * Presentation only. The server stores and validates the two signed values and
 * has no idea these four boxes exist.
 */

export interface OffsetDirections {
  upDots: number
  rightDots: number
  downDots: number
  leftDots: number
}

export interface Offset {
  offsetXDots: number
  offsetYDots: number
}

/** Positive x is right, positive y is down — the bitmap's own convention. */
export function directionsToOffset(directions: OffsetDirections): Offset {
  return {
    offsetXDots: Math.round(directions.rightDots - directions.leftDots),
    offsetYDots: Math.round(directions.downDots - directions.upDots),
  }
}

export function offsetToDirections(offset: Offset): OffsetDirections {
  return {
    upDots: offset.offsetYDots < 0 ? -offset.offsetYDots : 0,
    downDots: offset.offsetYDots > 0 ? offset.offsetYDots : 0,
    leftDots: offset.offsetXDots < 0 ? -offset.offsetXDots : 0,
    rightDots: offset.offsetXDots > 0 ? offset.offsetXDots : 0,
  }
}

/** Typing into one box clears the one facing it, so the pair stays coherent. */
export function setDirection(
  current: OffsetDirections,
  direction: keyof OffsetDirections,
  value: number,
): OffsetDirections {
  const opposite: Record<keyof OffsetDirections, keyof OffsetDirections> = {
    upDots: 'downDots',
    downDots: 'upDots',
    leftDots: 'rightDots',
    rightDots: 'leftDots',
  }
  return { ...current, [direction]: Math.max(0, value), [opposite[direction]]: 0 }
}
