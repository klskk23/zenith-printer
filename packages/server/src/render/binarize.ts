/**
 * RGBA -> BinaryBitmap.
 *
 * The threshold step is where the design's tolerances become physical. A
 * stroke thinner than one dot is smeared to grey by anti-aliasing and then
 * erased here; that is why the IR schema refuses sub-dot strokes rather than
 * leaving it to chance (FR-008).
 */
import type { BinaryBitmap } from '../drivers/port.ts'
import { RGBA_CHANNELS } from './image-source.ts'
import { halftone, type HalftoneMode, type HalftoneRegion } from './dither.ts'

export const DEFAULT_THRESHOLD = 128

const R_WEIGHT = 0.299
const G_WEIGHT = 0.587
const B_WEIGHT = 0.114

export interface BinarizeOptions {
  /** Pixels with luminance below this become print dots. */
  threshold?: number
  /**
   * Regions to halftone instead of thresholding — the image elements.
   *
   * Everything outside them keeps the hard threshold, which is what makes
   * glyph edges crisp and keeps stray dots out of the quiet zones between the
   * bars of a barcode.
   */
  halftone?: { mode: HalftoneMode; regions: readonly HalftoneRegion[] }
}

/** Luminance of one RGBA pixel, composited over white. */
export function luminance(pixels: Uint8Array, offset: number): number {
  const r = pixels[offset] ?? 255
  const g = pixels[offset + 1] ?? 255
  const b = pixels[offset + 2] ?? 255
  const a = pixels[offset + 3] ?? 255

  // Unpainted regions come back fully transparent with zeroed colour bytes.
  // Reading those as black would flood the whole label solid.
  const alpha = a / 255
  const rc = r * alpha + 255 * (1 - alpha)
  const gc = g * alpha + 255 * (1 - alpha)
  const bc = b * alpha + 255 * (1 - alpha)
  return R_WEIGHT * rc + G_WEIGHT * gc + B_WEIGHT * bc
}

/** Convert a resvg RGBA buffer into a packed 1-bit-per-pixel bitmap. */
export function binarize(
  pixels: Uint8Array,
  widthDots: number,
  heightDots: number,
  options: BinarizeOptions = {},
): BinaryBitmap {
  const expected = widthDots * heightDots * RGBA_CHANNELS
  if (pixels.length !== expected) {
    throw new Error(
      `expected ${expected} bytes for ${widthDots}x${heightDots} RGBA, received ${pixels.length}`,
    )
  }

  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const bytesPerRow = Math.ceil(widthDots / 8)
  const data = new Uint8Array(bytesPerRow * heightDots)

  // Luminance once, not twice: halftoning reads the same values the threshold
  // does, and a second pass computing them again is a second chance for the
  // two to disagree.
  // Float, not bytes: rounding here would move the threshold by half a unit
  // and change which anti-aliased edge pixels burn, for no gain.
  const luma = new Float32Array(widthDots * heightDots)
  for (let i = 0; i < luma.length; i += 1) {
    // The `* RGBA_CHANNELS` is load-bearing; see render/image-source.ts.
    luma[i] = luminance(pixels, i * RGBA_CHANNELS)
  }

  const overlay =
    options.halftone === undefined
      ? null
      : halftone(luma, widthDots, heightDots, options.halftone.regions, options.halftone.mode)

  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      const index = y * widthDots + x
      const burn =
        overlay !== null && overlay.mask[index] === 1
          ? overlay.burn[index] === 1
          : (luma[index] ?? 255) < threshold

      if (burn) {
        const byteIndex = y * bytesPerRow + (x >> 3)
        data[byteIndex] = (data[byteIndex] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }

  return { widthDots, heightDots, data }
}

/** Whether the dot at (x, y) is set. Intended for tests and diagnostics. */
export function isDotSet(bitmap: BinaryBitmap, x: number, y: number): boolean {
  if (x < 0 || x >= bitmap.widthDots || y < 0 || y >= bitmap.heightDots) {
    return false
  }
  const bytesPerRow = Math.ceil(bitmap.widthDots / 8)
  const byte = bitmap.data[y * bytesPerRow + (x >> 3)] ?? 0
  return (byte & (0x80 >> (x & 7))) !== 0
}

/** Count of set dots — used to assert that thin strokes survived. */
export function countSetDots(bitmap: BinaryBitmap): number {
  let count = 0
  for (const byte of bitmap.data) {
    let b = byte
    while (b !== 0) {
      count += b & 1
      b >>= 1
    }
  }
  return count
}
