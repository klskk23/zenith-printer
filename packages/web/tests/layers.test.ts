import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import {
  bringToFront,
  isBackmost,
  isFrontmost,
  layersTopFirst,
  sendToBack,
} from '../src/editor/layers.ts'

function ir(): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50, heightMm: 30, dpi: 203,
    elements: ['a', 'b', 'c'].map((id, index) => ({
      id, type: 'rect', xMm: index, yMm: index, widthMm: 10, heightMm: 10, strokeWidthDots: 1,
    })),
  })
}

const order = (label: LabelIR): string[] => label.elements.map((e) => e.id)

describe('layer order', () => {
  it('lists the topmost element first', () => {
    // Draw order is array order, so the last element is the one on top.
    expect(layersTopFirst(ir()).map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('brings an element to the front', () => {
    expect(order(bringToFront(ir(), 'a'))).toEqual(['b', 'c', 'a'])
  })

  it('sends an element to the back', () => {
    expect(order(sendToBack(ir(), 'c'))).toEqual(['c', 'a', 'b'])
  })

  it('leaves the other elements in their relative order', () => {
    expect(order(bringToFront(ir(), 'b'))).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op for an element already in place', () => {
    expect(order(bringToFront(ir(), 'c'))).toEqual(['a', 'b', 'c'])
    expect(order(sendToBack(ir(), 'a'))).toEqual(['a', 'b', 'c'])
  })

  it('ignores an unknown id rather than dropping elements', () => {
    const before = ir()
    expect(order(bringToFront(before, 'missing'))).toEqual(order(before))
    expect(order(sendToBack(before, 'missing'))).toEqual(order(before))
  })

  it('never loses or duplicates an element', () => {
    for (const id of ['a', 'b', 'c']) {
      expect(order(bringToFront(ir(), id)).sort()).toEqual(['a', 'b', 'c'])
      expect(order(sendToBack(ir(), id)).sort()).toEqual(['a', 'b', 'c'])
    }
  })

  it('reports which element is at each end', () => {
    const label = ir()
    expect(isFrontmost(label, 'c')).toBe(true)
    expect(isFrontmost(label, 'a')).toBe(false)
    expect(isBackmost(label, 'a')).toBe(true)
    expect(isBackmost(label, 'c')).toBe(false)
  })

  it('keeps the panel order in step with the canvas', () => {
    const moved = bringToFront(ir(), 'a')
    expect(layersTopFirst(moved).map((e) => e.id)).toEqual(['a', 'c', 'b'])
  })
})
