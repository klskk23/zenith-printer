import { describe, expect, it } from 'vitest'
import { applyOffset } from '../../src/render/offset.ts'
import { countSetDots, isDotSet } from '../../src/render/binarize.ts'
import type { BinaryBitmap } from '../../src/drivers/port.ts'

function bitmapFrom(rows: string[]): BinaryBitmap {
  const heightDots = rows.length
  const widthDots = rows[0]?.length ?? 0
  const bytesPerRow = Math.ceil(widthDots / 8)
  const data = new Uint8Array(bytesPerRow * heightDots)
  for (let y = 0; y < heightDots; y += 1) {
    for (let x = 0; x < widthDots; x += 1) {
      if (rows[y]?.[x] === '#') {
        const i = y * bytesPerRow + (x >> 3)
        data[i] = (data[i] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return { widthDots, heightDots, data }
}

describe('translation', () => {
  it('shifts content right and down', () => {
    const result = applyOffset(bitmapFrom(['#.......', '........']), { offsetXDots: 2, offsetYDots: 1 })
    expect(isDotSet(result.bitmap, 2, 1)).toBe(true)
    expect(isDotSet(result.bitmap, 0, 0)).toBe(false)
  })

  it('shifts content left and up', () => {
    const result = applyOffset(bitmapFrom(['........', '..#.....']), { offsetXDots: -2, offsetYDots: -1 })
    expect(isDotSet(result.bitmap, 0, 0)).toBe(true)
  })

  it('returns the original bitmap untouched for a zero offset', () => {
    const original = bitmapFrom(['#.......'])
    const result = applyOffset(original, { offsetXDots: 0, offsetYDots: 0 })
    expect(result.bitmap).toBe(original)
    expect(result.hasClipping).toBe(false)
  })

  it('rejects a fractional offset', () => {
    // Offsets are adjusted in whole dots; a fraction has no physical meaning.
    expect(() => applyOffset(bitmapFrom(['#...']), { offsetXDots: 0.5, offsetYDots: 0 })).toThrow(/whole/i)
  })
})

describe('clipping', () => {
  it('clips silently rather than failing', () => {
    // Nudging an offset repeatedly into a modal dialog would be miserable.
    const result = applyOffset(bitmapFrom(['#.......']), { offsetXDots: -1, offsetYDots: 0 })
    expect(countSetDots(result.bitmap)).toBe(0)
    expect(result.hasClipping).toBe(true)
  })

  it('reports how much was lost off each edge', () => {
    const result = applyOffset(bitmapFrom(['##......', '........']), { offsetXDots: -2, offsetYDots: 0 })
    expect(result.clipped.left).toBe(2)
    expect(result.clipped.right).toBe(0)
  })

  it('reports clipping off the right edge', () => {
    const result = applyOffset(bitmapFrom(['.......#']), { offsetXDots: 2, offsetYDots: 0 })
    expect(result.clipped.right).toBeGreaterThan(0)
    expect(result.hasClipping).toBe(true)
  })

  it('reports clipping off the bottom edge', () => {
    const result = applyOffset(bitmapFrom(['........', '#.......']), { offsetXDots: 0, offsetYDots: 3 })
    expect(result.clipped.bottom).toBeGreaterThan(0)
  })

  it('reports no clipping when everything still fits', () => {
    const result = applyOffset(bitmapFrom(['#.......', '........']), { offsetXDots: 1, offsetYDots: 1 })
    expect(result.hasClipping).toBe(false)
    expect(result.clipped).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe('canvas size', () => {
  it('keeps the canvas dimensions unchanged', () => {
    const result = applyOffset(bitmapFrom(['#.......', '........']), { offsetXDots: 3, offsetYDots: 1 })
    expect(result.bitmap.widthDots).toBe(8)
    expect(result.bitmap.heightDots).toBe(2)
  })
})
