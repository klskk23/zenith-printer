/**
 * What resizing means, per element type.
 *
 * The types differ genuinely, not decoratively:
 *
 *   - **text** resizes its box only. Stretching glyphs to fill a box distorts
 *     letterforms, and the printer has no distorted face to render with, so it
 *     would look one way on screen and another on paper. Font size stays a
 *     separate control.
 *   - **barcode** resizes freely in height and in quantised steps in width,
 *     because its width is moduleWidth x moduleCount and nothing in between
 *     exists.
 *   - **image** stays proportional — a stretched photo just looks wrong.
 *   - **qrcode** stays square *and* steps: a QR's side is
 *     moduleWidth x moduleCount, so a stretched one does not scan and an
 *     in-between one does not exist.
 *   - **rect** and **ellipse** resize freely — a box has no intrinsic ratio —
 *     with Shift for a square or circle.
 */
import type { LabelElement } from '@zenith/shared'
import { snapLengthMm, type SnapContext } from './snapping.ts'

export type ResizeMode = 'uniform' | 'free' | 'box-only' | 'height-and-steps' | 'square-and-steps'

export function resizeModeFor(element: LabelElement): ResizeMode {
  switch (element.type) {
    case 'image':
      return 'uniform'
    case 'qrcode':
      // Square like an image, but its side is moduleWidth x moduleCount, so
      // the free sizes in between do not exist. Treating it as merely uniform
      // let the handle produce a side the renderer then quietly refused.
      return 'square-and-steps'
    case 'text':
      return 'box-only'
    case 'barcode':
      return 'height-and-steps'
    case 'rect':
    case 'ellipse':
      return 'free'
    case 'line':
      // A line is resized by its endpoints, not by a box.
      return 'free'
  }
}

export interface Size {
  widthMm: number
  heightMm: number
}

export interface ResizeRequest {
  mode: ResizeMode
  original: Size
  desired: Size
  /** Held to force a proportional result on an otherwise free shape. */
  lockAspect?: boolean
  /** Smallest legal side, so an element cannot be collapsed to nothing. */
  minMm?: number
  /** Quantises width for barcodes; ignored otherwise. */
  snapWidthMm?: (targetMm: number) => number
}

const DEFAULT_MIN_MM = 0.5

/** Apply the type's rule to a proposed size. */
export function applyResize(request: ResizeRequest): Size {
  const min = request.minMm ?? DEFAULT_MIN_MM
  const { original, desired, mode } = request

  const clamp = (value: number): number => Math.max(min, value)

  if (mode === 'uniform' || (mode === 'free' && request.lockAspect === true)) {
    const ratio = original.heightMm === 0 ? 1 : original.widthMm / original.heightMm
    // Follow whichever axis the pointer pushed further, so the drag feels like
    // it is doing what the hand is doing.
    const byWidth = Math.abs(desired.widthMm - original.widthMm)
    const byHeight = Math.abs(desired.heightMm - original.heightMm)
    if (byWidth >= byHeight) {
      const widthMm = clamp(desired.widthMm)
      return { widthMm, heightMm: clamp(ratio === 0 ? desired.heightMm : widthMm / ratio) }
    }
    const heightMm = clamp(desired.heightMm)
    return { widthMm: clamp(heightMm * ratio), heightMm }
  }

  if (mode === 'square-and-steps') {
    // Whichever axis the pointer pushed further drives the side; the symbology
    // then decides which nearby side actually exists.
    const byWidth = Math.abs(desired.widthMm - original.widthMm)
    const byHeight = Math.abs(desired.heightMm - original.heightMm)
    const requested = byWidth >= byHeight ? desired.widthMm : desired.heightMm
    const side = clamp(request.snapWidthMm?.(requested) ?? requested)
    return { widthMm: side, heightMm: side }
  }

  if (mode === 'height-and-steps') {
    return {
      widthMm: clamp(request.snapWidthMm?.(desired.widthMm) ?? original.widthMm),
      heightMm: clamp(desired.heightMm),
    }
  }

  // 'box-only' and 'free' both take the requested box; the difference is what
  // the caller does with the result — text leaves its glyphs alone.
  return { widthMm: clamp(desired.widthMm), heightMm: clamp(desired.heightMm) }
}

/**
 * Snap a resize request, then apply the type's rule to it.
 *
 * The order is the whole point. Snapping the *result* — which is what the
 * canvas did — undoes the rule that had just been applied: a barcode width is
 * moduleWidth x moduleCount and nothing in between, and rounding that to the
 * nearest millimetre lands between two legal widths; a QR code's sides are
 * equal, and rounding them separately makes it a rectangle, which does not
 * scan. Snapping the request instead means the grid decides what was asked for
 * and the type decides what is possible, which is the right way round.
 *
 * This was harmless while the snap step was a single dot, because a quantised
 * width is already a whole number of dots and half a dot of aspect error is
 * invisible. It stopped being harmless the moment the step became something
 * the user could see.
 */
export function resizeSnapped(request: ResizeRequest, context: SnapContext): Size {
  return applyResize({
    ...request,
    desired: {
      widthMm: snapLengthMm(request.desired.widthMm, context),
      heightMm: snapLengthMm(request.desired.heightMm, context),
    },
  })
}
