/**
 * Zoom arithmetic and the rules around it.
 *
 * Separated from the component because the decisions here are the part worth
 * checking: which modifier zooms, how far one notch moves, where the limits
 * are. None of that needs a DOM, and the DOM available in tests does not carry
 * `altKey` on a synthetic wheel event anyway.
 */

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 8

/** Gentle enough that a single notch is a nudge rather than a jump. */
const WHEEL_SENSITIVITY = 0.0015

/**
 * Share of the available width a fitted label takes.
 *
 * Not all of it: the rotation handle sits above the top edge, elements are
 * dragged past the sides while being positioned, and a label flush against its
 * container reads as part of the application rather than as a piece of paper.
 */
export const FIT_SHARE = 0.85

/** Never shrink below this share of the width, however tall the label is. */
export const MIN_FIT_SHARE = 0.7

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export interface WheelIntent {
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  deltaY: number
}

/**
 * Whether a wheel event is asking to zoom.
 *
 * Alt, not Ctrl. Ctrl + wheel is the browser's own page zoom and the browser
 * wins — React registers its wheel listener at the root as a passive one, so
 * `preventDefault` in an `onWheel` prop is silently ignored and the page zooms
 * regardless.
 *
 * Alt also means "ignore the grid" while dragging (FR-033). The two do not
 * collide: one is a pointer drag, the other a wheel, and no gesture is both.
 */
export function isZoomGesture(event: WheelIntent): boolean {
  return event.altKey === true
}

/** The zoom a wheel notch produces. Returns the current value when it is not a zoom. */
export function zoomFromWheel(current: number, event: WheelIntent): number {
  if (!isZoomGesture(event)) {
    return current
  }
  return clampZoom(current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY))
}

export interface FitInput {
  availableWidth: number
  availableHeight: number
  widthDots: number
  heightDots: number
}

/**
 * The zoom at which the label fits its column.
 *
 * Width takes precedence: the label occupies at least `MIN_FIT_SHARE` of the
 * column however tall it is. Height only reduces the zoom within the band left
 * above that floor — which means a tall label overflows downwards and scrolls
 * rather than shrinking to a sliver. That is the right trade for labels, whose
 * legibility is a function of width, but it does mean the height term is
 * inactive for anything much taller than the column.
 */
export function fitZoom(input: FitInput): number {
  const { availableWidth, availableHeight, widthDots, heightDots } = input
  if (availableWidth <= 0 || widthDots <= 0) {
    return 1
  }

  const byWidth = (availableWidth * FIT_SHARE) / widthDots
  const byHeight =
    availableHeight > 0 && heightDots > 0 ? (availableHeight * FIT_SHARE) / heightDots : byWidth
  const floor = (availableWidth * MIN_FIT_SHARE) / widthDots

  return clampZoom(Math.max(floor, Math.min(byWidth, byHeight)))
}
