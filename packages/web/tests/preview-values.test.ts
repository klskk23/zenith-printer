/**
 * Drawing a design whose content is not decided yet.
 *
 * Binding an element to a variable field used to blank the whole editor: the
 * renderer refuses a `$var` it has no value for, and the throw escaped React's
 * render pass. It is right to refuse when printing; the editor is where those
 * bindings are made, so it needs an answer for every one of them.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { previewIr } from '../src/editor/preview-values.ts'
import type { VariableField } from '../src/features/templates/hooks.ts'

function ir(content: unknown): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [
      {
        id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 30, heightMm: 6,
        content, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
      },
    ],
  })
}

const manual: VariableField = { name: 'partNo', label: 'Part', source: 'manual', sampleValue: 'ABC-12345' }
const serial: VariableField = { name: 'serial', label: 'Serial', source: 'sequence', seqStart: 41, seqDigits: 4 }

function contentOf(resolved: LabelIR): unknown {
  return (resolved.elements[0] as { content: unknown }).content
}

describe('a bound element', () => {
  it('draws with the sample the author gave', () => {
    expect(contentOf(previewIr(ir({ $var: 'partNo' }), [manual]))).toBe('ABC-12345')
  })

  it('draws a sequence at the number the next batch will start on', () => {
    // Not 1: the suggestion continues from what has already been printed, and
    // a design laid out against 0001 is laid out against the wrong width.
    expect(contentOf(previewIr(ir({ $var: 'serial' }), [serial]))).toBe('0041')
  })

  it('leaves fixed content alone', () => {
    expect(contentOf(previewIr(ir('PLAIN'), [manual]))).toBe('PLAIN')
  })
})

describe('bindings with nothing behind them', () => {
  /**
   * The crash this exists to prevent. Every state a design passes through
   * mid-edit has to be drawable; the guards say what is wrong, and the print
   * path refuses on its own terms.
   */
  it('does not throw for a field that does not exist', () => {
    expect(() => previewIr(ir({ $var: 'field1' }), [])).not.toThrow()
  })

  it('does not throw for a field that was deleted', () => {
    expect(() => previewIr(ir({ $var: 'partNo' }), [serial])).not.toThrow()
  })

  it('draws it as nothing rather than as its own name', () => {
    // A label reading "{partNo}" looks like a design decision.
    expect(contentOf(previewIr(ir({ $var: 'gone' }), []))).toBe('')
  })

  it('still fills in the fields that do exist', () => {
    const design = labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [
        { id: 'a', type: 'text', xMm: 2, yMm: 2, widthMm: 20, heightMm: 5, content: { $var: 'partNo' }, fontFamily: 'f', fontSizeMm: 3 },
        { id: 'b', type: 'text', xMm: 2, yMm: 8, widthMm: 20, heightMm: 5, content: { $var: 'gone' }, fontFamily: 'f', fontSizeMm: 3 },
      ],
    })
    const resolved = previewIr(design, [manual])
    expect((resolved.elements[0] as { content: unknown }).content).toBe('ABC-12345')
    expect((resolved.elements[1] as { content: unknown }).content).toBe('')
  })
})

describe('the stored design', () => {
  it('keeps its bindings', () => {
    // An edit made while looking at a sample has to write back the binding,
    // not the sample.
    const design = ir({ $var: 'partNo' })
    previewIr(design, [manual])
    expect(contentOf(design)).toEqual({ $var: 'partNo' })
  })
})

describe('a field with no sample', () => {
  it('draws as nothing, which is honest about a field nobody described', () => {
    const bare: VariableField = { name: 'partNo', label: 'Part', source: 'manual' }
    expect(contentOf(previewIr(ir({ $var: 'partNo' }), [bare]))).toBe('')
  })
})
