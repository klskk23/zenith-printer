import { describe, expect, it } from 'vitest'
import { RGBA_CHANNELS, ResvgImageSource } from '../../src/render/image-source.ts'

/**
 * Build an RGBA buffer from a picture drawn with characters.
 * '#' is black, '.' is white, ' ' is fully transparent.
 */
function rgbaFrom(rows: string[]): { pixels: Uint8Array; width: number; height: number } {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const pixels = new Uint8Array(width * height * RGBA_CHANNELS)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = rows[y]?.[x] ?? '.'
      const offset = (y * width + x) * RGBA_CHANNELS
      const value = cell === '#' ? 0 : 255
      const alpha = cell === ' ' ? 0 : 255
      pixels[offset] = value
      pixels[offset + 1] = value
      pixels[offset + 2] = value
      pixels[offset + 3] = alpha
    }
  }
  return { pixels, width, height }
}

describe('RGBA indexing', () => {
  it('samples four bytes per pixel, not one', () => {
    // This is the whole reason the class exists. A single-channel index reads
    // a neighbouring pixel's colour channel: no error, just a garbled label.
    const { pixels, width, height } = rgbaFrom([
      '#...',
      '....',
      '....',
      '....',
    ])
    const source = new ResvgImageSource(pixels, width, height)

    expect(source.isPixelNonWhite(0, 0, 'top')).toBe(true)
    expect(source.isPixelNonWhite(1, 0, 'top')).toBe(false)
    expect(source.isPixelNonWhite(2, 0, 'top')).toBe(false)
    expect(source.isPixelNonWhite(3, 0, 'top')).toBe(false)
  })

  it('would disagree with a single-channel reading', () => {
    // Pin the defect directly: byte index 1 in an RGBA buffer is the green
    // channel of pixel 0, whereas the naive formula treats it as pixel 1.
    const { pixels, width, height } = rgbaFrom(['#.'])
    const source = new ResvgImageSource(pixels, width, height)

    const naiveIndexForPixel1 = 1
    const correctIndexForPixel1 = 1 * RGBA_CHANNELS

    expect(pixels[naiveIndexForPixel1]).toBe(0) // still pixel 0 (green channel)
    expect(pixels[correctIndexForPixel1]).toBe(255) // actually pixel 1
    expect(source.isPixelNonWhite(1, 0, 'top')).toBe(false)
  })

  it('rejects a buffer whose length does not match RGBA', () => {
    // A greyscale buffer slipping through would silently misread everything.
    const greyscale = new Uint8Array(4 * 4)
    expect(() => new ResvgImageSource(greyscale, 4, 4)).toThrow(/RGBA/i)
  })

  it('reads every row, including the last', () => {
    const { pixels, width, height } = rgbaFrom(['....', '....', '....', '...#'])
    const source = new ResvgImageSource(pixels, width, height)
    expect(source.isPixelNonWhite(3, 3, 'top')).toBe(true)
  })
})

describe('luminance', () => {
  it('treats a transparent pixel as blank rather than black', () => {
    // resvg leaves unpainted areas fully transparent with zeroed colour bytes.
    // Reading those as black would flood the label solid.
    const { pixels, width, height } = rgbaFrom(['  ', '  '])
    const source = new ResvgImageSource(pixels, width, height)
    expect(source.isPixelNonWhite(0, 0, 'top')).toBe(false)
    expect(source.luminanceAt(0, 0)).toBeCloseTo(255, 5)
  })

  it('weights the channels for luminance', () => {
    const pixels = new Uint8Array([0, 255, 0, 255])
    const source = new ResvgImageSource(pixels, 1, 1)
    expect(source.luminanceAt(0, 0)).toBeCloseTo(0.587 * 255, 5)
  })

  it('honours a custom threshold', () => {
    const mid = new Uint8Array([100, 100, 100, 255])
    expect(new ResvgImageSource(mid, 1, 1, { threshold: 128 }).isPixelNonWhite(0, 0, 'top')).toBe(true)
    expect(new ResvgImageSource(mid, 1, 1, { threshold: 50 }).isPixelNonWhite(0, 0, 'top')).toBe(false)
  })
})

describe('print direction', () => {
  it('rotates 90 degrees clockwise for the left direction', () => {
    // A mark in the top-left of a landscape image must appear top-right after
    // a clockwise quarter turn.
    const { pixels, width, height } = rgbaFrom([
      '#..',
      '...',
    ])
    const source = new ResvgImageSource(pixels, width, height)

    // Destination (x=0, y=1) maps back to source (x = height-1-y = 0, y = x = 0).
    expect(source.isPixelNonWhite(0, 1, 'left')).toBe(true)
    expect(source.isPixelNonWhite(0, 0, 'left')).toBe(false)
  })

  it('leaves the image alone for the top direction', () => {
    // B3S_P reports printDirection 'top'; this is the path that actually runs.
    const { pixels, width, height } = rgbaFrom(['#.', '..'])
    const source = new ResvgImageSource(pixels, width, height)
    expect(source.isPixelNonWhite(0, 0, 'top')).toBe(true)
    expect(source.isPixelNonWhite(1, 1, 'top')).toBe(false)
  })

  it('returns blank rather than throwing for out-of-bounds reads', () => {
    const { pixels, width, height } = rgbaFrom(['##', '##'])
    const source = new ResvgImageSource(pixels, width, height)
    expect(source.isPixelNonWhite(99, 99, 'top')).toBe(false)
    expect(source.isPixelNonWhite(-1, 0, 'top')).toBe(false)
  })
})
