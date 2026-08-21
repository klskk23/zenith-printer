import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { encodeMonochromePng } from '../../src/render/png.ts'
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

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Walk the chunk list so structure can be asserted without a PNG library. */
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = []
  let offset = SIGNATURE.length
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    out.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    offset += 12 + length
  }
  return out
}

describe('structure', () => {
  it('starts with the PNG signature', () => {
    expect(encodeMonochromePng(bitmapFrom(['#.'])).subarray(0, 8)).toEqual(SIGNATURE)
  })

  it('emits IHDR, IDAT and IEND in order', () => {
    expect(chunks(encodeMonochromePng(bitmapFrom(['#.']))).map((c) => c.type)).toEqual([
      'IHDR',
      'IDAT',
      'IEND',
    ])
  })

  it('declares the bitmap dimensions', () => {
    const ihdr = chunks(encodeMonochromePng(bitmapFrom(['####', '####', '####']))).find(
      (c) => c.type === 'IHDR',
    )
    expect(ihdr?.data.readUInt32BE(0)).toBe(4)
    expect(ihdr?.data.readUInt32BE(4)).toBe(3)
  })

  it('declares 8-bit greyscale', () => {
    const ihdr = chunks(encodeMonochromePng(bitmapFrom(['#']))).find((c) => c.type === 'IHDR')
    expect(ihdr?.data[8]).toBe(8)
    expect(ihdr?.data[9]).toBe(0)
  })
})

describe('pixel fidelity', () => {
  function decodePixels(png: Buffer, width: number, height: number): number[][] {
    const idat = chunks(png).find((c) => c.type === 'IDAT')
    const raw = inflateSync(idat?.data ?? Buffer.alloc(0))
    const rows: number[][] = []
    for (let y = 0; y < height; y += 1) {
      const start = y * (width + 1) + 1
      rows.push([...raw.subarray(start, start + width)])
    }
    return rows
  }

  it('renders a set dot as black and a clear dot as white', () => {
    // The preview exists to show exactly what the head will burn, so any
    // softening between the bitmap and the image defeats its purpose.
    const png = encodeMonochromePng(bitmapFrom(['#.#.']))
    expect(decodePixels(png, 4, 1)[0]).toEqual([0, 255, 0, 255])
  })

  it('keeps rows independent', () => {
    const png = encodeMonochromePng(bitmapFrom(['##..', '..##']))
    expect(decodePixels(png, 4, 2)).toEqual([
      [0, 0, 255, 255],
      [255, 255, 0, 0],
    ])
  })

  it('uses no per-row filtering, so bytes map straight to pixels', () => {
    const idat = chunks(encodeMonochromePng(bitmapFrom(['#', '#']))).find((c) => c.type === 'IDAT')
    const raw = inflateSync(idat?.data ?? Buffer.alloc(0))
    expect(raw[0]).toBe(0)
    expect(raw[2]).toBe(0)
  })

  it('handles a width that is not a multiple of eight', () => {
    const png = encodeMonochromePng(bitmapFrom(['#....#....#']))
    expect(decodePixels(png, 11, 1)[0]).toEqual([0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 0])
  })

  it('encodes a realistic 400x240 label', () => {
    const rows = Array.from({ length: 240 }, () => '#'.repeat(400))
    const png = encodeMonochromePng(bitmapFrom(rows))
    const ihdr = chunks(png).find((c) => c.type === 'IHDR')
    expect(ihdr?.data.readUInt32BE(0)).toBe(400)
    expect(ihdr?.data.readUInt32BE(4)).toBe(240)
  })
})

describe('determinism', () => {
  it('produces identical bytes for identical input', () => {
    const rows = ['#.#.#.#.', '.#.#.#.#']
    expect(encodeMonochromePng(bitmapFrom(rows))).toEqual(encodeMonochromePng(bitmapFrom(rows)))
  })
})
