/**
 * Adapters from raw pixel buffers to niimbluelib's `ImageSource` interface.
 *
 * ⚠️ The reason this file has its own test suite:
 *
 * niimblue-node's `SharpImageSource` samples with `buffer.at(y * width + x)`,
 * which is correct there because it converts to single-channel greyscale first
 * (`.toColorspace("b-w")`). resvg hands back **RGBA**, four bytes per pixel, so
 * the same expression reads a byte belonging to a different pixel's colour
 * channel. Nothing throws. Nothing logs. The label just comes out as noise.
 *
 * Copying that line without multiplying the index by 4 is the single most
 * likely silent defect in this codebase, so it is covered explicitly.
 */
import type { ImageSource, PrintDirection } from '@mmote/niimbluelib'

/** Bytes per pixel in a resvg RGBA buffer. */
export const RGBA_CHANNELS = 4

/** Luminance weights matching the binarisation step. */
const R_WEIGHT = 0.299
const G_WEIGHT = 0.587
const B_WEIGHT = 0.114

export const DEFAULT_THRESHOLD = 128

export interface ResvgImageSourceOptions {
  /** Pixels darker than this become print dots. */
  threshold?: number
}

/**
 * Wraps a resvg RGBA buffer so niimbluelib's `ImageEncoder` can read it.
 *
 * `printDirection === 'left'` rotates the image 90 degrees clockwise. That
 * index transform is ported from niimblue-node rather than re-derived: it is
 * easy to get subtly wrong and hard to notice until a label prints sideways.
 */
export class ResvgImageSource implements ImageSource {
  readonly width: number
  readonly height: number

  readonly #pixels: Uint8Array
  readonly #threshold: number

  constructor(pixels: Uint8Array, width: number, height: number, options: ResvgImageSourceOptions = {}) {
    const expected = width * height * RGBA_CHANNELS
    if (pixels.length !== expected) {
      throw new Error(
        `expected ${expected} bytes for ${width}x${height} RGBA, received ${pixels.length}. ` +
          'A length mismatch usually means the buffer is single-channel greyscale, not RGBA.',
      )
    }
    this.width = width
    this.height = height
    this.#pixels = pixels
    this.#threshold = options.threshold ?? DEFAULT_THRESHOLD
  }

  /** Luminance of the pixel at (x, y), 0-255. */
  luminanceAt(x: number, y: number): number {
    // The `* RGBA_CHANNELS` here is the whole point of this class.
    const offset = (y * this.width + x) * RGBA_CHANNELS
    const r = this.#pixels[offset] ?? 255
    const g = this.#pixels[offset + 1] ?? 255
    const b = this.#pixels[offset + 2] ?? 255
    const a = this.#pixels[offset + 3] ?? 255

    // Composite over white: an unpainted area must read as blank, not as black.
    const alpha = a / 255
    const rc = r * alpha + 255 * (1 - alpha)
    const gc = g * alpha + 255 * (1 - alpha)
    const bc = b * alpha + 255 * (1 - alpha)

    return R_WEIGHT * rc + G_WEIGHT * gc + B_WEIGHT * bc
  }

  isPixelNonWhite(x: number, y: number, printDirection: PrintDirection = 'left'): boolean {
    if (printDirection === 'left') {
      // 90 degrees clockwise: the source row becomes the destination column.
      const sx = this.height - 1 - y
      const sy = x
      if (sx < 0 || sx >= this.width || sy < 0 || sy >= this.height) {
        return false
      }
      return this.luminanceAt(sx, sy) < this.#threshold
    }

    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false
    }
    return this.luminanceAt(x, y) < this.#threshold
  }
}
