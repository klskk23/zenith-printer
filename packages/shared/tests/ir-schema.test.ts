import { describe, expect, it } from 'vitest'
import {
  isVariableRef,
  labelElementSchema,
  labelIrSchema,
  referencedVariables,
  strokeWidthDotsSchema,
} from '../src/ir/schema.ts'

const line = {
  id: 'l1',
  type: 'line' as const,
  xMm: 0,
  yMm: 0,
  x2Mm: 10,
  y2Mm: 0,
  strokeWidthDots: 1,
}

describe('stroke width', () => {
  it('accepts one whole dot', () => {
    expect(strokeWidthDotsSchema.parse(1)).toBe(1)
  })

  it('rejects anything thinner than one dot', () => {
    // Sub-dot strokes are smeared by anti-aliasing and then thresholded away,
    // so the label comes out missing the line with no error anywhere (FR-008).
    expect(() => strokeWidthDotsSchema.parse(0)).toThrow()
    expect(() => strokeWidthDotsSchema.parse(0.5)).toThrow()
  })

  it('rejects fractional dots', () => {
    expect(() => strokeWidthDotsSchema.parse(1.5)).toThrow()
  })
})

describe('schema surface', () => {
  it('does not accept opacity, gradients or shadows', () => {
    // These are not merely discouraged: their behaviour after a hard threshold
    // is unpredictable, so they are absent from the schema entirely.
    const parsed = labelElementSchema.parse({ ...line, opacity: 0.5, gradient: 'x', shadow: true })
    expect(parsed).not.toHaveProperty('opacity')
    expect(parsed).not.toHaveProperty('gradient')
    expect(parsed).not.toHaveProperty('shadow')
  })

  it('defaults rotation to zero', () => {
    expect(labelElementSchema.parse(line).rotation).toBe(0)
  })

  it('rejects an unknown element type', () => {
    expect(() => labelElementSchema.parse({ ...line, type: 'ellipse' })).toThrow()
  })

  it('rejects a rotation that is not a right angle', () => {
    expect(() => labelElementSchema.parse({ ...line, rotation: 45 })).toThrow()
  })
})

describe('element content', () => {
  const text = {
    id: 't1',
    type: 'text' as const,
    xMm: 1,
    yMm: 1,
    widthMm: 20,
    heightMm: 5,
    fontFamily: 'Noto Sans CJK SC',
    fontSizeMm: 3,
  }

  it('accepts a literal string', () => {
    const parsed = labelElementSchema.parse({ ...text, content: 'ABC-12345' })
    expect(isVariableRef(parsed.type === 'text' ? parsed.content : '')).toBe(false)
  })

  it('accepts a variable reference', () => {
    const parsed = labelElementSchema.parse({ ...text, content: { $var: 'partNo' } })
    expect(parsed.type).toBe('text')
    if (parsed.type === 'text') {
      expect(isVariableRef(parsed.content)).toBe(true)
    }
  })

  it('rejects a variable name that is not an identifier', () => {
    expect(() => labelElementSchema.parse({ ...text, content: { $var: '1bad' } })).toThrow()
    expect(() => labelElementSchema.parse({ ...text, content: { $var: '' } })).toThrow()
  })

  it('rejects an unsupported barcode symbology', () => {
    expect(() =>
      labelElementSchema.parse({
        ...text,
        type: 'barcode',
        content: '123',
        symbology: 'pdf417',
      }),
    ).toThrow()
  })
})

describe('label', () => {
  const label = { widthMm: 50, heightMm: 30, dpi: 203, elements: [line] }

  it('parses a minimal label', () => {
    expect(labelIrSchema.parse(label).elements).toHaveLength(1)
  })

  it('rejects a non-positive canvas', () => {
    expect(() => labelIrSchema.parse({ ...label, widthMm: 0 })).toThrow()
    expect(() => labelIrSchema.parse({ ...label, heightMm: -1 })).toThrow()
  })

  it('rejects duplicate element ids', () => {
    expect(() => labelIrSchema.parse({ ...label, elements: [line, line] })).toThrow(/unique/i)
  })
})

describe('referencedVariables', () => {
  it('collects each field once, in document order', () => {
    const ir = labelIrSchema.parse({
      widthMm: 50,
      heightMm: 30,
      dpi: 203,
      elements: [
        { id: 'a', type: 'barcode', xMm: 1, yMm: 1, widthMm: 30, heightMm: 10, content: { $var: 'serial' }, symbology: 'code128' },
        { id: 'b', type: 'text', xMm: 1, yMm: 12, widthMm: 30, heightMm: 5, content: { $var: 'partNo' }, fontFamily: 'F', fontSizeMm: 3 },
        { id: 'c', type: 'text', xMm: 1, yMm: 18, widthMm: 30, heightMm: 5, content: { $var: 'serial' }, fontFamily: 'F', fontSizeMm: 3 },
        { id: 'd', type: 'text', xMm: 1, yMm: 24, widthMm: 30, heightMm: 5, content: 'fixed', fontFamily: 'F', fontSizeMm: 3 },
      ],
    })
    expect(referencedVariables(ir)).toEqual(['serial', 'partNo'])
  })

  it('returns nothing for a fully literal label', () => {
    expect(referencedVariables(labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements: [line] }))).toEqual([])
  })
})
