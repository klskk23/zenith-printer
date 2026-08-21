/**
 * Halftoning.
 *
 * The property that matters is not "which dots" — that varies by algorithm —
 * but that a flat grey comes out at roughly the right *density*, that the
 * result is confined to the region asked for, and that a hard threshold's job
 * is left alone everywhere else.
 */
import { describe, expect, it } from 'vitest'
import { halftone, type HalftoneMode, type HalftoneRegion } from '../../src/render/dither.ts'

const W = 32
const H = 32

/** A whole-label luminance map filled with one value. */
function flat(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value)
}

const WHOLE: HalftoneRegion = { xDots: 0, yDots: 0, widthDots: W, heightDots: H }

function burntShare(overlay: { mask: Uint8Array; burn: Uint8Array }, region: HalftoneRegion): number {
  let burnt = 0
  let total = 0
  for (let y = region.yDots; y < region.yDots + region.heightDots; y += 1) {
    for (let x = region.xDots; x < region.xDots + region.widthDots; x += 1) {
      total += 1
      burnt += overlay.burn[y * W + x] ?? 0
    }
  }
  return burnt / total
}

const MODES: HalftoneMode[] = ['floyd-steinberg', 'ordered']

describe('doing nothing', () => {
  it('returns nothing when halftoning is off', () => {
    expect(halftone(flat(128), W, H, [WHOLE], 'none')).toBeNull()
  })

  it('returns nothing when there is nothing to halftone', () => {
    // The overwhelmingly common case: a label with no images on it. Two
    // buffers the size of the label should not be allocated for it.
    expect(halftone(flat(128), W, H, [], 'floyd-steinberg')).toBeNull()
  })
})

describe.each(MODES)('%s', (mode) => {
  it('burns almost everything for black', () => {
    expect(burntShare(halftone(flat(0), W, H, [WHOLE], mode)!, WHOLE)).toBeGreaterThan(0.98)
  })

  it('burns almost nothing for white', () => {
    expect(burntShare(halftone(flat(255), W, H, [WHOLE], mode)!, WHOLE)).toBeLessThan(0.02)
  })

  /**
   * The whole point of the exercise: a tone the printer cannot produce comes
   * out as the right *proportion* of dots. A hard threshold gives 0% or 100%
   * and nothing else.
   */
  it.each([
    [64, 0.75],
    [128, 0.5],
    [192, 0.25],
  ])('turns a flat %i into about %f coverage', (value, expected) => {
    expect(burntShare(halftone(flat(value), W, H, [WHOLE], mode)!, WHOLE)).toBeCloseTo(expected, 1)
  })

  it('gets darker as the tone gets darker', () => {
    const shares = [220, 160, 96, 32].map(
      (v) => burntShare(halftone(flat(v), W, H, [WHOLE], mode)!, WHOLE),
    )
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i]!).toBeGreaterThan(shares[i - 1]!)
    }
  })

  it('touches nothing outside the region', () => {
    const region: HalftoneRegion = { xDots: 8, yDots: 8, widthDots: 8, heightDots: 8 }
    const overlay = halftone(flat(128), W, H, [region], mode)!

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const inside = x >= 8 && x < 16 && y >= 8 && y < 16
        expect(overlay.mask[y * W + x], `pixel ${x},${y}`).toBe(inside ? 1 : 0)
      }
    }
  })

  it('handles several regions at once', () => {
    const a: HalftoneRegion = { xDots: 0, yDots: 0, widthDots: 8, heightDots: 8 }
    const b: HalftoneRegion = { xDots: 20, yDots: 20, widthDots: 8, heightDots: 8 }
    const overlay = halftone(flat(128), W, H, [a, b], mode)!
    expect(overlay.mask[0]).toBe(1)
    expect(overlay.mask[21 * W + 21]).toBe(1)
    expect(overlay.mask[10 * W + 10]).toBe(0)
  })

  it('clips a region that runs off the label', () => {
    // An image dragged past the edge is a normal intermediate state; the
    // region has to be trimmed rather than indexed out of bounds.
    const overhang: HalftoneRegion = { xDots: -10, yDots: -10, widthDots: W + 40, heightDots: H + 40 }
    expect(() => halftone(flat(128), W, H, [overhang], mode)).not.toThrow()
    expect(burntShare(halftone(flat(128), W, H, [overhang], mode)!, WHOLE)).toBeCloseTo(0.5, 1)
  })

  it('ignores a region entirely off the label', () => {
    const away: HalftoneRegion = { xDots: 100, yDots: 100, widthDots: 8, heightDots: 8 }
    const overlay = halftone(flat(128), W, H, [away], mode)!
    expect(overlay.mask.some((v) => v === 1)).toBe(false)
  })

  it('is deterministic', () => {
    // Constitution: the same template must render identically after a
    // redeploy, which rules out anything random in here.
    const first = halftone(flat(150), W, H, [WHOLE], mode)!
    const second = halftone(flat(150), W, H, [WHOLE], mode)!
    expect([...first.burn]).toEqual([...second.burn])
  })
})

describe('floyd-steinberg', () => {
  /**
   * The error has to stay inside the region. Letting it run past the edge
   * smears the picture's darkness into the paper beside it, which shows up as
   * a grey haze along one side of every image.
   */
  it('does not leak error into the paper beside the image', () => {
    const luma = new Uint8Array(W * H).fill(255)
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        luma[y * W + x] = 20
      }
    }
    const overlay = halftone(luma, W, H, [{ xDots: 8, yDots: 8, widthDots: 8, heightDots: 8 }], 'floyd-steinberg')!

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (x < 8 || x >= 16 || y < 8 || y >= 16) {
          expect(overlay.burn[y * W + x], `pixel ${x},${y}`).toBe(0)
        }
      }
    }
  })
})

describe('ordered', () => {
  /**
   * Indexed by absolute position, so two images that abut do not show a seam
   * where the screen restarts.
   */
  it('keeps the screen aligned across separate regions', () => {
    const left: HalftoneRegion = { xDots: 0, yDots: 0, widthDots: 16, heightDots: 16 }
    const right: HalftoneRegion = { xDots: 16, yDots: 0, widthDots: 16, heightDots: 16 }

    const split = halftone(flat(128), W, H, [left, right], 'ordered')!
    const whole = halftone(flat(128), W, H, [{ xDots: 0, yDots: 0, widthDots: 32, heightDots: 16 }], 'ordered')!

    expect([...split.burn]).toEqual([...whole.burn])
  })
})
