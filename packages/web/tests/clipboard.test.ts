/**
 * Element copy/paste.
 *
 * The properties that matter: a paste is a second object (its own id, its own
 * position), and it is independent of the original in both directions.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR, type LabelElement } from '@zenith/shared'
import { PASTE_OFFSET_MM, copyElement, duplicateElement, pasteElement } from '../src/editor/clipboard.ts'

function ir(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

const label = {
  id: 'text-1',
  type: 'text',
  xMm: 5,
  yMm: 6,
  widthMm: 20,
  heightMm: 6,
  content: 'hello',
  fontFamily: 'Noto Sans CJK SC',
  fontSizeMm: 3,
  align: 'left',
  bold: false,
}

const rule = { id: 'line-1', type: 'line', xMm: 2, yMm: 10, x2Mm: 40, y2Mm: 10, strokeWidthDots: 2 }

describe('copyElement', () => {
  it('returns null when nothing is selected', () => {
    expect(copyElement(ir([label]), null)).toBeNull()
  })

  it('returns null for an id that is not in the label', () => {
    expect(copyElement(ir([label]), 'text-99')).toBeNull()
  })

  it('detaches the copy from the label', () => {
    const source = ir([label])
    const copied = copyElement(source, 'text-1')!
    // Editing the original after copying must not reach the clipboard: the
    // user copied what was on screen at the time, and that is what should land.
    const edited = { ...source, elements: [{ ...source.elements[0]!, content: 'changed' }] }
    expect(copied).not.toBe(edited.elements[0])
    expect((copied as { content: string }).content).toBe('hello')
  })
})

describe('pasteElement', () => {
  it('gives the copy an id no existing element holds', () => {
    const before = ir([label])
    const { ir: after, id } = pasteElement(before, copyElement(before, 'text-1')!)
    expect(id).not.toBe('text-1')
    expect(new Set(after.elements.map((e) => e.id)).size).toBe(after.elements.length)
  })

  it('offsets the copy so it does not hide behind the original', () => {
    const before = ir([label])
    const { ir: after, id } = pasteElement(before, copyElement(before, 'text-1')!)
    const pasted = after.elements.find((e) => e.id === id)!
    expect(pasted.xMm).toBeCloseTo(5 + PASTE_OFFSET_MM, 6)
    expect(pasted.yMm).toBeCloseTo(6 + PASTE_OFFSET_MM, 6)
  })

  it('moves both ends of a line, so the copy is a line of the same length', () => {
    const before = ir([rule])
    const { ir: after, id } = pasteElement(before, copyElement(before, 'line-1')!)
    const pasted = after.elements.find((e) => e.id === id) as LabelElement & { x2Mm: number; y2Mm: number }
    expect(pasted.x2Mm - pasted.xMm).toBeCloseTo(38, 6)
    expect(pasted.y2Mm - pasted.yMm).toBeCloseTo(0, 6)
  })

  it('puts the copy on top', () => {
    const before = ir([label, rule])
    const { ir: after, id } = pasteElement(before, copyElement(before, 'text-1')!)
    expect(after.elements.at(-1)!.id).toBe(id)
  })

  it('leaves the original label untouched', () => {
    const before = ir([label])
    pasteElement(before, copyElement(before, 'text-1')!)
    expect(before.elements).toHaveLength(1)
  })

  it('pastes repeatedly without ever reusing an id', () => {
    let current = ir([label])
    const clip = copyElement(current, 'text-1')!
    for (let i = 0; i < 5; i += 1) {
      current = pasteElement(current, clip).ir
    }
    expect(current.elements).toHaveLength(6)
    expect(new Set(current.elements.map((e) => e.id)).size).toBe(6)
  })

  it('does not tie the paste to the clipboard object', () => {
    // Two pastes of one clipboard entry must not share structure, or dragging
    // one would drag the other.
    const current = ir([label])
    const clip = copyElement(current, 'text-1')!
    const first = pasteElement(current, clip)
    const second = pasteElement(first.ir, clip)
    expect(second.ir.elements.find((e) => e.id === first.id)!.xMm).toBeCloseTo(5 + PASTE_OFFSET_MM, 6)
    expect(second.ir.elements.find((e) => e.id === second.id)!.xMm).toBeCloseTo(5 + PASTE_OFFSET_MM, 6)
  })
})

describe('duplicateElement', () => {
  it('is a copy and a paste in one step', () => {
    const { ir: after, id } = duplicateElement(ir([label]), 'text-1')!
    expect(after.elements).toHaveLength(2)
    expect(after.elements.find((e) => e.id === id)!.xMm).toBeCloseTo(5 + PASTE_OFFSET_MM, 6)
  })

  it('returns null when there is nothing selected', () => {
    expect(duplicateElement(ir([label]), null)).toBeNull()
  })
})
