/**
 * What the rulers highlight when something is selected.
 *
 * Measured with the same `boundsOf` the canvas outlines from, so the band on
 * the ruler and the frame on the label always describe one rectangle. Two
 * measurements would eventually disagree, and the disagreement reads as "the
 * ruler says 40 dots but the element is clearly wider than that".
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { selectionSpans, spanLengthDots } from '../src/editor/ruler-span.ts'

function ir(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

/** 20x10 mm at 5,4 — 160x80 dots at 40,32 on the 203 dpi grid. */
const BOX = { id: 'r', type: 'rect', xMm: 5, yMm: 4, widthMm: 20, heightMm: 10, strokeWidthDots: 2 }
const RULE = { id: 'l', type: 'line', xMm: 2, yMm: 10, x2Mm: 42, y2Mm: 10, strokeWidthDots: 2 }

describe('nothing to show', () => {
  it('is null when nothing is selected', () => {
    expect(selectionSpans(ir([BOX]), null)).toBeNull()
  })

  it('is null when the selection has been deleted', () => {
    // Deleting clears the selection, but the two do not have to land in the
    // same render — and an id that matches nothing must not throw.
    expect(selectionSpans(ir([BOX]), 'gone')).toBeNull()
  })
})

describe('an ordinary element', () => {
  it('reports where it starts on each axis', () => {
    const spans = selectionSpans(ir([BOX]), 'r')!
    expect(spans.x.startDots).toBe(40)
    expect(spans.y.startDots).toBe(32)
  })

  it('reports how far it reaches', () => {
    const spans = selectionSpans(ir([BOX]), 'r')!
    expect(spanLengthDots(spans.x)).toBe(160)
    expect(spanLengthDots(spans.y)).toBe(80)
  })

  it('agrees with the millimetres it was given', () => {
    const spans = selectionSpans(ir([BOX]), 'r')!
    expect(Math.round((spanLengthDots(spans.x) * 25.4) / 203)).toBe(20)
    expect(Math.round((spanLengthDots(spans.y) * 25.4) / 203)).toBe(10)
  })
})

describe('a rotated element', () => {
  /**
   * The space it occupies, not the box it was drawn from. A 20x10 turned a
   * quarter turn covers 10x20, and a ruler saying otherwise would contradict
   * the frame drawn around it on the canvas.
   */
  it('reports the space it actually occupies', () => {
    const spans = selectionSpans(ir([{ ...BOX, rotation: 90 }]), 'r')!
    expect(spanLengthDots(spans.x)).toBe(80)
    expect(spanLengthDots(spans.y)).toBe(160)
  })

  it('is unchanged by a half turn', () => {
    const upright = selectionSpans(ir([BOX]), 'r')!
    const flipped = selectionSpans(ir([{ ...BOX, rotation: 180 }]), 'r')!
    expect(flipped).toEqual(upright)
  })
})

describe('a line', () => {
  it('spans its own extent, not a box around a point', () => {
    const spans = selectionSpans(ir([RULE]), 'l')!
    expect(spanLengthDots(spans.x)).toBe(320)
  })

  it('is not negative when drawn right to left', () => {
    const backwards = { ...RULE, xMm: 42, x2Mm: 2 }
    expect(spanLengthDots(selectionSpans(ir([backwards]), 'l')!.x)).toBe(320)
  })

  it('has no thickness on the axis it does not cross', () => {
    // A horizontal rule occupies one row; the vertical span is zero dots, and
    // the ruler has to cope with a band of no width rather than draw nothing.
    expect(spanLengthDots(selectionSpans(ir([RULE]), 'l')!.y)).toBe(0)
  })
})
