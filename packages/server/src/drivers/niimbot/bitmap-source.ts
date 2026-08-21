/**
 * Adapter from our packed BinaryBitmap to niimbluelib's ImageSource.
 *
 * The renderer has already thresholded, so this only unpacks bits — no
 * luminance work, no second threshold, no chance of the two disagreeing.
 */
import type { ImageSource, PrintDirection } from '@mmote/niimbluelib'
import type { BinaryBitmap } from '../port.ts'
import { sourceFor } from './rotate.ts'

export class BitmapImageSource implements ImageSource {
  readonly width: number
  readonly height: number

  readonly #bitmap: BinaryBitmap
  readonly #bytesPerRow: number

  constructor(bitmap: BinaryBitmap) {
    this.#bitmap = bitmap
    this.width = bitmap.widthDots
    this.height = bitmap.heightDots
    this.#bytesPerRow = Math.ceil(bitmap.widthDots / 8)
  }

  isPixelNonWhite(x: number, y: number, printDirection: PrintDirection = 'left'): boolean {
    const source = sourceFor(x, y, this.width, this.height, printDirection)
    if (source === undefined) {
      return false
    }
    const byte = this.#bitmap.data[source.y * this.#bytesPerRow + (source.x >> 3)] ?? 0
    return (byte & (0x80 >> (source.x & 7))) !== 0
  }
}
