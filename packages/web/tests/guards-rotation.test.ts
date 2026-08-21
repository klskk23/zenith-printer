/**
 * Overflow detection under rotation.
 *
 * `boundsOf` ignored rotation until this feature. It was harmless while nothing
 * could rotate; the moment the handle exists, a 40x10 barcode turned on its
 * side is checked as if it were still 40x10 and half of it falls off the label
 * with no warning.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { blockingViolations, boundsOf, inspect, isOutOfBounds } from '../src/editor/guards.ts'

// 832 dots at 203 dpi is 104 mm — wide enough that the canvas itself is not a
// violation, so these tests isolate the question of overflow severity.
const LIMITS = { dpi: 203, printheadPixels: 832 }

function label(element: Record<string, unknown>): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements: [element] })
}

const WIDE_BARCODE = {
  id: 'b', type: 'barcode', xMm: 5, yMm: 10, widthMm: 40, heightMm: 10,
  content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2,
}

describe('boundsOf under rotation', () => {
  it('leaves an unrotated element alone', () => {
    const ir = label(WIDE_BARCODE)
    expect(boundsOf(ir.elements[0]!)).toMatchObject({ widthMm: 40, heightMm: 10 })
  })

  it('swaps the extents at 90 degrees', () => {
    const ir = label({ ...WIDE_BARCODE, rotation: 90 })
    expect(boundsOf(ir.elements[0]!)).toMatchObject({ widthMm: 10, heightMm: 40 })
  })

  it.each([90, 270])('swaps the extents at %i degrees', (rotation) => {
    const ir = label({ ...WIDE_BARCODE, rotation })
    const box = boundsOf(ir.elements[0]!)
    expect(box.widthMm).toBe(10)
    expect(box.heightMm).toBe(40)
  })

  it('leaves extents unchanged at 180 degrees', () => {
    const ir = label({ ...WIDE_BARCODE, rotation: 180 })
    expect(boundsOf(ir.elements[0]!)).toMatchObject({ widthMm: 40, heightMm: 10 })
  })

  it('handles a rotated line by its endpoints', () => {
    const ir = label({
      id: 'l', type: 'line', xMm: 2, yMm: 5, x2Mm: 42, y2Mm: 5, strokeWidthDots: 1, rotation: 90,
    })
    const box = boundsOf(ir.elements[0]!)
    expect(box.widthMm).toBe(0)
    expect(box.heightMm).toBe(40)
  })
})

describe('overflow detection under rotation', () => {
  it('accepts a barcode that fits lying down', () => {
    // 40 wide on a 50mm label: fine.
    const ir = label(WIDE_BARCODE)
    expect(isOutOfBounds(ir.elements[0]!, ir)).toBe(false)
  })

  it('catches the same barcode standing up', () => {
    // 40 tall on a 30mm label: it does not fit, and without rotation-aware
    // bounds nothing would have said so.
    const ir = label({ ...WIDE_BARCODE, rotation: 90, yMm: 5 })
    expect(isOutOfBounds(ir.elements[0]!, ir)).toBe(true)
  })

  it('accepts a rotated element that still fits', () => {
    const ir = label({
      id: 'r', type: 'rect', xMm: 5, yMm: 5, widthMm: 20, heightMm: 10,
      strokeWidthDots: 2, rotation: 90,
    })
    expect(isOutOfBounds(ir.elements[0]!, ir)).toBe(false)
  })
})

/**
 * FR-067: overflow warns, it does not block. Content past the edge is clipped
 * and the user decides whether that is acceptable — the judgement is theirs,
 * and a batch held back for one clipped label is worse than a label to reprint.
 */
describe('overflow severity', () => {
  it('reports a rotated overflow as a warning', () => {
    const ir = label({ ...WIDE_BARCODE, rotation: 90, yMm: 5 })
    const overflow = inspect(ir, LIMITS).filter((v) => v.code === 'ELEMENT_OUT_OF_BOUNDS')
    expect(overflow).toHaveLength(1)
    expect(overflow[0]!.blocking).toBe(false)
  })

  it('does not disable printing because of an overflow', () => {
    const ir = label({ ...WIDE_BARCODE, rotation: 90, yMm: 5 })
    expect(blockingViolations(inspect(ir, LIMITS))).toEqual([])
  })

  it('still blocks the things that cannot be printed at all', () => {
    const ir = label({ ...WIDE_BARCODE, content: '' })
    expect(blockingViolations(inspect(ir, LIMITS)).map((v) => v.code)).toContain('BARCODE_CONTENT_EMPTY')
  })
})
