import { describe, expect, it } from 'vitest'
import type { NiimbotAbstractClient } from '@mmote/niimbluelib'
import { NiimbotDriver } from '../../src/drivers/niimbot/niimbot-driver.ts'
import { BitmapImageSource } from '../../src/drivers/niimbot/bitmap-source.ts'
import { rotatedSize, sourceFor } from '../../src/drivers/niimbot/rotate.ts'
import type { BinaryBitmap, PageSource } from '../../src/drivers/port.ts'
import { B3SP_METADATA, FakeNiimbotClient } from '../support/fake-niimbot-client.ts'

/**
 * The port's page source, from a plain array.
 *
 * Drivers pull pages one at a time now; these tests care about what is sent,
 * not about how the pages arrive, so they wrap a list.
 */
function source(pages: BinaryBitmap[]): PageSource {
  return { total: pages.length, at: (index: number) => pages[index]! }
}

/** '#' sets a dot. */
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

describe('bitmap unpacking', () => {
  it('reads back exactly the dots that were packed', () => {
    const source = new BitmapImageSource(bitmapFrom(['#.#.....', '.#.#....']))
    expect(source.isPixelNonWhite(0, 0, 'top')).toBe(true)
    expect(source.isPixelNonWhite(1, 0, 'top')).toBe(false)
    expect(source.isPixelNonWhite(2, 0, 'top')).toBe(true)
    expect(source.isPixelNonWhite(1, 1, 'top')).toBe(true)
  })

  it('does not re-threshold: the renderer already decided', () => {
    // A second threshold here could disagree with the one that produced the
    // preview, so this layer only unpacks bits.
    const source = new BitmapImageSource(bitmapFrom(['########']))
    for (let x = 0; x < 8; x += 1) {
      expect(source.isPixelNonWhite(x, 0, 'top')).toBe(true)
    }
  })

  it('reports blank outside the canvas rather than throwing', () => {
    const source = new BitmapImageSource(bitmapFrom(['####']))
    expect(source.isPixelNonWhite(99, 99, 'top')).toBe(false)
  })
})

describe('print direction transform', () => {
  it('is identity for the top direction', () => {
    // B3S_P reports 'top'; this is the path that actually runs.
    expect(sourceFor(3, 1, 8, 4, 'top')).toEqual({ x: 3, y: 1 })
  })

  it('rotates 90 degrees clockwise for the left direction', () => {
    // Ported, not re-derived: the failure mode is a sideways label.
    expect(sourceFor(0, 0, 4, 2, 'left')).toEqual({ x: 1, y: 0 })
    expect(sourceFor(0, 1, 4, 2, 'left')).toEqual({ x: 0, y: 0 })
  })

  it('swaps the dimensions when rotating', () => {
    expect(rotatedSize(400, 240, 'left')).toEqual({ width: 240, height: 400 })
    expect(rotatedSize(400, 240, 'top')).toEqual({ width: 400, height: 240 })
  })

  it('rejects coordinates outside the source', () => {
    expect(sourceFor(99, 0, 4, 2, 'left')).toBeUndefined()
    expect(sourceFor(-1, 0, 4, 2, 'top')).toBeUndefined()
  })

  it('maps a top-left mark to the top-right after a clockwise turn', () => {
    const source = new BitmapImageSource(bitmapFrom(['#.......', '........']))
    // Destination (0, 1) maps back to source (0, 0).
    expect(source.isPixelNonWhite(0, 1, 'left')).toBe(true)
    expect(source.isPixelNonWhite(0, 0, 'left')).toBe(false)
  })
})

describe('encoded page data', () => {
  async function encodeVia(bitmap: BinaryBitmap): Promise<{ cols: number; rows: number; blackPixels: number }> {
    const client = new FakeNiimbotClient({ metadata: B3SP_METADATA })
    const driver = new NiimbotDriver({
      createClient: () => client as unknown as NiimbotAbstractClient,
      printTaskName: 'B1',
      address: '/dev/ttyACM0',
    })
    await driver.connect()
    await driver.printPages(source([bitmap]), { density: 3, labelType: 1, printDirection: 'top' }, () => {})

    const encoded = client.printedPages[0]
    if (encoded === undefined) {
      throw new Error('no page was encoded')
    }
    const blackPixels = encoded.rowsData.reduce((sum, row) => sum + row.blackPixelsCount, 0)
    return { cols: encoded.cols, rows: encoded.rows, blackPixels }
  }

  it('preserves the canvas dimensions', async () => {
    const result = await encodeVia(bitmapFrom(['########', '........', '########']))
    expect(result.cols).toBe(8)
    expect(result.rows).toBe(3)
  })

  it('counts exactly the dots that were set', async () => {
    // A miscount here means the wrong pixels reach the head — the failure that
    // looks like noise on paper and like nothing in the code.
    const result = await encodeVia(bitmapFrom(['########', '........', '########']))
    expect(result.blackPixels).toBe(16)
  })

  it('encodes a blank page as no dots at all', async () => {
    expect((await encodeVia(bitmapFrom(['........', '........']))).blackPixels).toBe(0)
  })

  it('is deterministic for identical input', async () => {
    const rows = ['#.#.#.#.', '.#.#.#.#']
    expect(await encodeVia(bitmapFrom(rows))).toEqual(await encodeVia(bitmapFrom(rows)))
  })

  it('encodes a realistic 400x240 label without dropping rows', async () => {
    const rows = Array.from({ length: 240 }, (_, y) =>
      y % 2 === 0 ? '#'.repeat(400) : '.'.repeat(400),
    )
    const result = await encodeVia(bitmapFrom(rows))
    expect(result.cols).toBe(400)
    expect(result.rows).toBe(240)
    expect(result.blackPixels).toBe(120 * 400)
  })
})
