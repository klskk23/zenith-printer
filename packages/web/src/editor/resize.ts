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
 *   - **image** and **qrcode** stay proportional. A stretched QR does not scan;
 *     a stretched photo just looks wrong.
 *   - **rect** and **ellipse** resize freely — a box has no intrinsic ratio —
 *     with Shift for a square or circle.
 */
import type { LabelElement } from '@zenith/shared'

export type ResizeMode = 'uniform' | 'free' | 'box-only' | 'height-and-steps'

export function resizeModeFor(element: LabelElement): ResizeMode {
  switch (element.type) {
    case 'image':
    case 'qrcode':
      return 'uniform'
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
