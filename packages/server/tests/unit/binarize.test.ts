import { describe, expect, it } from 'vitest'
import { binarize, countSetDots, isDotSet, luminance } from '../../src/render/binarize.ts'

/** '#' black, '.' white, ' ' transparent, 'g' mid grey. */
function rgba(rows: string[]): { pixels: Uint8Array; width: number; height: number } {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = rows[y]?.[x] ?? '.'
      const o = (y * width + x) * 4
      const v = cell === '#' ? 0 : cell === 'g' ? 100 : 255
      pixels[o] = v
      pixels[o + 1] = v
      pixels[o + 2] = v
      pixels[o + 3] = cell === ' ' ? 0 : 255
    }
  }
  return { pixels, width, height }
}

describe('thin strokes', () => {
  it('keeps a one-dot horizontal rule visible', () => {
    // FR-008 relies on this: one dot is the thinnest mark that survives.
    const { pixels, width, height } = rgba(['........', '########', '........'])
    const bitmap = binarize(pixels, width, height)
    for (let x = 0; x < width; x += 1) {
      expect(isDotSet(bitmap, x, 1)).toBe(true)
    }
    expect(countSetDots(bitmap)).toBe(8)
  })

  it('keeps a one-dot vertical rule visible', () => {
    const { pixels, width, height } = rgba(['..#.....', '..#.....', '..#.....'])
    const bitmap = binarize(pixels, width, height)
    expect(isDotSet(bitmap, 2, 0)).toBe(true)
    expect(isDotSet(bitmap, 2, 2)).toBe(true)
    expect(countSetDots(bitmap)).toBe(3)
  })

  it('drops a stroke that anti-aliasing greyed past the threshold', () => {
    // A sub-dot stroke arrives as light grey and is removed here — exactly the
    // silent disappearance the schema prevents upstream.
    const { pixels, width, height } = rgba(['........', 'gggggggg', '........'])
    expect(countSetDots(binarize(pixels, width, height, { threshold: 50 }))).toBe(0)
    expect(countSetDots(binarize(pixels, width, height, { threshold: 200 }))).toBe(8)
  })
})

describe('packing', () => {
  it('packs eight dots per byte, most significant bit leftmost', () => {
    const { pixels, width, height } = rgba(['#.......'])
    const bitmap = binarize(pixels, width, height)
    expect(bitmap.data[0]).toBe(0x80)
  })

  it('pads each row to a whole byte', () => {
    const { pixels, width, height } = rgba(['###', '###'])
    const bitmap = binarize(pixels, width, height)
    expect(bitmap.data.length).toBe(2)
  })

  it('does not let one row bleed into the next', () => {
    const { pixels, width, height } = rgba(['###', '...'])
    const bitmap = binarize(pixels, width, height)
    expect(isDotSet(bitmap, 0, 1)).toBe(false)
  })
})

describe('transparency', () => {
  it('treats an unpainted pixel as blank, not black', () => {
    // resvg leaves untouched areas transparent with zeroed colour bytes.
    const { pixels, width, height } = rgba(['    ', '    '])
    expect(countSetDots(binarize(pixels, width, height))).toBe(0)
  })

  it('composites over white when computing luminance', () => {
    expect(luminance(new Uint8Array([0, 0, 0, 0]), 0)).toBeCloseTo(255, 5)
    expect(luminance(new Uint8Array([0, 0, 0, 255]), 0)).toBeCloseTo(0, 5)
  })
})

describe('validation', () => {
  it('rejects a buffer that is not RGBA-sized', () => {
    expect(() => binarize(new Uint8Array(9), 3, 3)).toThrow(/RGBA|bytes/i)
  })
})

describe('determinism', () => {
  it('produces identical bytes for identical input', () => {
    const { pixels, width, height } = rgba(['#.#.', '.#.#'])
    expect(binarize(pixels, width, height).data).toEqual(binarize(pixels, width, height).data)
  })
})
