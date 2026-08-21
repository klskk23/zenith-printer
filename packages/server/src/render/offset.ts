/**
 * Position correction, applied by translating the bitmap.
 *
 * Deliberately not delegated to device commands such as ZPL's `^LH`: doing it
 * here keeps both printers behaving identically and, more importantly, lets the
 * editor preview show the corrected result. Otherwise the only way to judge an
 * offset is to burn a label and look at it (FR-028).
 *
 * Content pushed outside the canvas is clipped silently, and the clipped region
 * is reported so the editor can mark it. Blocking the user with an error would
 * be worse: offsets are adjusted by nudging, and nudging repeatedly into a
 * modal is miserable.
 */
import { isDotSet, type BinarizeOptions } from './binarize.ts'
import type { BinaryBitmap } from '../drivers/port.ts'

export interface ClippedRegion {
  top: number
  right: number
  bottom: number
  left: number
}

export interface OffsetResult {
  bitmap: BinaryBitmap
  /** Dots lost off each edge. All zero when nothing was clipped. */
  clipped: ClippedRegion
  hasClipping: boolean
}

export interface OffsetOptions extends BinarizeOptions {
  offsetXDots: number
  offsetYDots: number
}

/** Translate a bitmap, clipping whatever leaves the canvas. */
export function applyOffset(bitmap: BinaryBitmap, options: OffsetOptions): OffsetResult {
  const { offsetXDots: dx, offsetYDots: dy } = options
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new Error(`offset must be a whole number of dots, received ${dx},${dy}`)
  }

  if (dx === 0 && dy === 0) {
    return {
      bitmap,
      clipped: { top: 0, right: 0, bottom: 0, left: 0 },
      hasClipping: false,
    }
  }

  const { widthDots, heightDots } = bitmap
  const bytesPerRow = Math.ceil(widthDots / 8)
  const data = new Uint8Array(bytesPerRow * heightDots)

  const clipped: ClippedRegion = { top: 0, right: 0, bottom: 0, left: 0 }

  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      if (!isDotSet(bitmap, x, y)) {
        continue
      }
      const tx = x + dx
      const ty = y + dy

      if (tx < 0) {
        clipped.left = Math.max(clipped.left, -tx)
        continue
      }
      if (tx >= widthDots) {
        clipped.right = Math.max(clipped.right, tx - widthDots + 1)
        continue
      }
      if (ty < 0) {
        clipped.top = Math.max(clipped.top, -ty)
        continue
      }
      if (ty >= heightDots) {
        clipped.bottom = Math.max(clipped.bottom, ty - heightDots + 1)
        continue
      }

      const byteIndex = ty * bytesPerRow + (tx >> 3)
      data[byteIndex] = (data[byteIndex] ?? 0) | (0x80 >> (tx & 7))
    }
  }

  const hasClipping =
    clipped.top > 0 || clipped.right > 0 || clipped.bottom > 0 || clipped.left > 0

  return { bitmap: { widthDots, heightDots, data }, clipped, hasClipping }
}
