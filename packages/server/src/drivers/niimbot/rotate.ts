/**
 * Print-direction index transform.
 *
 * Ported from niimblue-node's `SharpImageSource` rather than re-derived. The
 * expression is short but easy to get subtly wrong, and the failure mode is a
 * label that prints sideways or mirrored — obvious on paper, invisible in code.
 *
 * `printDirection === 'left'` rotates the image 90 degrees clockwise: the
 * source row becomes the destination column.
 */
export interface SourcePoint {
  x: number
  y: number
}

/**
 * Map a destination coordinate back to its source pixel.
 * `sourceWidth` / `sourceHeight` describe the unrotated image.
 */
export function sourceFor(
  x: number,
  y: number,
  sourceWidth: number,
  sourceHeight: number,
  printDirection: 'top' | 'left',
): SourcePoint | undefined {
  if (printDirection === 'top') {
    if (x < 0 || x >= sourceWidth || y < 0 || y >= sourceHeight) {
      return undefined
    }
    return { x, y }
  }

  const sx = sourceHeight - 1 - y
  const sy = x
  if (sx < 0 || sx >= sourceWidth || sy < 0 || sy >= sourceHeight) {
    return undefined
  }
  return { x: sx, y: sy }
}

/** Output dimensions after applying the direction. */
export function rotatedSize(
  width: number,
  height: number,
  printDirection: 'top' | 'left',
): { width: number; height: number } {
  return printDirection === 'left' ? { width: height, height: width } : { width, height }
}
