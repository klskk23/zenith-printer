/**
 * Choosing a profile sets the canvas to that stock.
 *
 * Designing on a 50x30 canvas for a roll that is 40x20 produces a label that is
 * wrong in a way nobody notices until it prints, so the canvas always equals
 * the real paper.
 *
 * What it does *not* do is move anything. Rescaling or reflowing elements would
 * be making layout decisions on the user's behalf, and the resulting
 * coordinates would no longer sit on the dot grid — the alignment the whole
 * editor works to preserve. Anything now outside the label is flagged, and the
 * size change is one undo away.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { commit, initUndo, undo } from '../src/editor/undo.ts'
import { inspect } from '../src/editor/guards.ts'

const LIMITS = { dpi: 203, printheadPixels: 832 }

function design(widthMm: number, heightMm: number): LabelIR {
  return labelIrSchema.parse({
    widthMm, heightMm, dpi: 203,
    elements: [
      { id: 'a', type: 'rect', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 1 },
      { id: 'b', type: 'rect', xMm: 30, yMm: 18, widthMm: 15, heightMm: 8, strokeWidthDots: 1 },
    ],
  })
}

/** What the editor does when a profile is chosen. */
const applyStock = (ir: LabelIR, widthMm: number, heightMm: number): LabelIR =>
  labelIrSchema.parse({ ...ir, widthMm, heightMm })

describe('canvas follows the profile', () => {
  it('resizes the canvas to the stock', () => {
    const next = applyStock(design(50, 30), 40, 20)
    expect(next).toMatchObject({ widthMm: 40, heightMm: 20 })
  })

  it('leaves every element exactly where it was', () => {
    const before = design(50, 30)
    const after = applyStock(before, 40, 20)
    expect(after.elements).toEqual(before.elements)
  })

  it('does not rescale elements to fit the smaller stock', () => {
    // Scaling would be a layout decision made on the user's behalf, and the
    // scaled coordinates would fall off the dot grid.
    const after = applyStock(design(50, 30), 40, 20)
    expect(after.elements[1]).toMatchObject({ xMm: 30, widthMm: 15 })
  })
})

describe('what the user sees afterwards', () => {
  it('flags elements that no longer fit', () => {
    const after = applyStock(design(50, 30), 40, 20)
    const overflow = inspect(after, LIMITS).filter((v) => v.code === 'ELEMENT_OUT_OF_BOUNDS')
    expect(overflow.map((v) => v.elementId)).toContain('b')
  })

  it('flags them as warnings, so printing is still possible', () => {
    const after = applyStock(design(50, 30), 40, 20)
    const overflow = inspect(after, LIMITS).filter((v) => v.code === 'ELEMENT_OUT_OF_BOUNDS')
    expect(overflow.every((v) => !v.blocking)).toBe(true)
  })

  it('says nothing when everything still fits', () => {
    const after = applyStock(design(50, 30), 60, 40)
    expect(inspect(after, LIMITS).filter((v) => v.code === 'ELEMENT_OUT_OF_BOUNDS')).toEqual([])
  })
})

describe('undoing the change', () => {
  it('restores the previous canvas size', () => {
    const before = design(50, 30)
    const state = commit(initUndo(before), applyStock(before, 40, 20))
    expect(undo(state).present).toMatchObject({ widthMm: 50, heightMm: 30 })
  })

  it('restores it with the elements untouched', () => {
    const before = design(50, 30)
    const state = commit(initUndo(before), applyStock(before, 40, 20))
    expect(undo(state).present.elements).toEqual(before.elements)
  })

  it('is a single step, not one per element', () => {
    const before = design(50, 30)
    const state = commit(initUndo(before), applyStock(before, 40, 20))
    expect(state.past).toHaveLength(1)
  })
})
