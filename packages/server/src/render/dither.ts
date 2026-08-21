/**
 * Halftoning — the appearance of grey from a printer that has none.
 *
 * A thermal head burns a dot or it does not; there is no intermediate. So a
 * photograph put through the ordinary threshold comes out as slabs of black
 * and white with nothing in between. Halftoning trades spatial resolution for
 * apparent tone: it varies how *densely* the dots fall, and at arm's length
 * the eye averages them into greys.
 *
 * This is not colour mixing, which needs more than one colorant and does not
 * apply to a machine whose only ink is heat.
 *
 * **Applied to image elements only, by region.** Text and barcodes are solid
 * black by construction, and their only greys are the anti-aliased fringe a
 * millimetre wide around each glyph. Halftoning that fringe would fray every
 * letter and put stray dots between the bars of a barcode, where a scanner
 * reads them as data. The hard threshold is what makes those edges crisp, and
 * it stays.
 */

export const HALFTONE_MODES = ['none', 'floyd-steinberg', 'ordered'] as const
export type HalftoneMode = (typeof HALFTONE_MODES)[number]

/** A rectangle of the label, in dots, that an image element occupies. */
export interface HalftoneRegion {
  xDots: number
  yDots: number
  widthDots: number
  heightDots: number
}

export interface HalftoneOverlay {
  /** 1 where a halftoned decision has been made for this pixel. */
  mask: Uint8Array
  /** 1 where that decision is "burn". Meaningless where `mask` is 0. */
  burn: Uint8Array
}

/**
 * The 8x8 Bayer matrix, scaled to 0-255.
 *
 * Indexed by absolute coordinates rather than by position within the region,
 * so two images that abut do not show a seam where the pattern restarts.
 */
const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => ((v + 0.5) * 256) / 64))

/**
 * Decide the pixels inside `regions` by halftoning.
 *
 * Returns null when there is nothing to do, so the caller can skip allocating
 * two buffers the size of the label for the overwhelmingly common case of a
 * label with no images on it.
 */
export function halftone(
  luma: ArrayLike<number>,
  widthDots: number,
  heightDots: number,
  regions: readonly HalftoneRegion[],
  mode: HalftoneMode,
): HalftoneOverlay | null {
  if (mode === 'none' || regions.length === 0) {
    return null
  }

  const mask = new Uint8Array(widthDots * heightDots)
  const burn = new Uint8Array(widthDots * heightDots)

  for (const region of regions) {
    const clipped = clip(region, widthDots, heightDots)
    if (clipped === null) {
      continue
    }
    if (mode === 'ordered') {
      applyOrdered(luma, widthDots, clipped, mask, burn)
    } else {
      applyFloydSteinberg(luma, widthDots, clipped, mask, burn)
    }
  }

  return { mask, burn }
}

/** The part of a region that is actually on the label. */
function clip(region: HalftoneRegion, widthDots: number, heightDots: number): Required<HalftoneRegion> | null {
  const left = Math.max(0, Math.floor(region.xDots))
  const top = Math.max(0, Math.floor(region.yDots))
  const right = Math.min(widthDots, Math.ceil(region.xDots + region.widthDots))
  const bottom = Math.min(heightDots, Math.ceil(region.yDots + region.heightDots))

  if (right <= left || bottom <= top) {
    return null
  }
  return { xDots: left, yDots: top, widthDots: right - left, heightDots: bottom - top }
}

/**
 * Ordered dithering: the threshold varies with position, nothing propagates.
 *
 * Coarser than error diffusion, and deliberately offered alongside it: the
 * regular pattern survives a thermal head better than scattered dots do. Heat
 * spreads into the paper around each burnt dot, so isolated dots grow and
 * clusters merge — which is what turns a finely diffused image muddy on stock
 * that a repeating screen prints cleanly.
 */
function applyOrdered(
  luma: ArrayLike<number>,
  widthDots: number,
  region: Required<HalftoneRegion>,
  mask: Uint8Array,
  burn: Uint8Array,
): void {
  for (let y = region.yDots; y < region.yDots + region.heightDots; y += 1) {
    for (let x = region.xDots; x < region.xDots + region.widthDots; x += 1) {
      const index = y * widthDots + x
      mask[index] = 1
      burn[index] = (luma[index] ?? 255) < (BAYER_8[y & 7]?.[x & 7] ?? 128) ? 1 : 0
    }
  }
}

/**
 * Floyd–Steinberg error diffusion.
 *
 * Each pixel is decided against the midpoint, and the difference between what
 * was wanted and what was drawn is pushed into the neighbours not yet visited.
 * The error stays inside the region: letting it run past the edge would smear
 * the picture's darkness into the white paper beside it, which shows up as a
 * grey haze along one side of every image.
 */
function applyFloydSteinberg(
  luma: ArrayLike<number>,
  widthDots: number,
  region: Required<HalftoneRegion>,
  mask: Uint8Array,
  burn: Uint8Array,
): void {
  const { widthDots: w, heightDots: h } = region
  // A working copy, because the error accumulates into it as we go.
  const working = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      working[y * w + x] = luma[(region.yDots + y) * widthDots + (region.xDots + x)] ?? 255
    }
  }

  const spill = (x: number, y: number, error: number, share: number): void => {
    if (x < 0 || x >= w || y < 0 || y >= h) {
      return
    }
    working[y * w + x] = (working[y * w + x] ?? 0) + error * share
  }

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const wanted = working[y * w + x] ?? 255
      const drawn = wanted < 128 ? 0 : 255
      const error = wanted - drawn

      const index = (region.yDots + y) * widthDots + (region.xDots + x)
      mask[index] = 1
      burn[index] = drawn === 0 ? 1 : 0

      spill(x + 1, y, error, 7 / 16)
      spill(x - 1, y + 1, error, 3 / 16)
      spill(x, y + 1, error, 5 / 16)
      spill(x + 1, y + 1, error, 1 / 16)
    }
  }
}
