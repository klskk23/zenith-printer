import { describe, expect, it } from 'vitest'
import {
  MissingVariableError,
  SequenceOverflowError,
  formatSequence,
  resolveVariables,
} from '../src/ir/resolve-variables.ts'
import { labelIrSchema, type LabelIR } from '../src/ir/schema.ts'

function makeIr(): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [
      {
        id: 'code',
        type: 'barcode',
        xMm: 2,
        yMm: 2,
        widthMm: 40,
        heightMm: 12,
        content: { $var: 'serial' },
        symbology: 'code128',
      },
      {
        id: 'part',
        type: 'text',
        xMm: 2,
        yMm: 18,
        widthMm: 40,
        heightMm: 5,
        content: { $var: 'partNo' },
        fontFamily: 'Noto Sans CJK SC',
        fontSizeMm: 3,
      },
      {
        id: 'fixed',
        type: 'text',
        xMm: 2,
        yMm: 24,
        widthMm: 40,
        heightMm: 4,
        content: 'MADE IN CN',
        fontFamily: 'Noto Sans CJK SC',
        fontSizeMm: 2.5,
      },
    ],
  })
}

describe('resolveVariables', () => {
  it('replaces every reference with its value', () => {
    const resolved = resolveVariables(makeIr(), { serial: '001', partNo: 'ABC-12345' })
    const contents = resolved.elements.map((e) => ('content' in e ? e.content : null))
    expect(contents).toEqual(['001', 'ABC-12345', 'MADE IN CN'])
  })

  it('leaves literal content untouched', () => {
    const resolved = resolveVariables(makeIr(), { serial: '001', partNo: 'X' })
    const fixed = resolved.elements.find((e) => e.id === 'fixed')
    expect(fixed && 'content' in fixed ? fixed.content : null).toBe('MADE IN CN')
  })

  it('does not mutate the input', () => {
    // The renderer calls this once per copy against the same template object.
    const ir = makeIr()
    const before = structuredClone(ir)
    resolveVariables(ir, { serial: '001', partNo: 'ABC' })
    expect(ir).toEqual(before)
  })

  it('returns a new object rather than the same reference', () => {
    const ir = makeIr()
    expect(resolveVariables(ir, { serial: '1', partNo: 'A' })).not.toBe(ir)
  })

  it('produces different output for different values, from the same input', () => {
    const ir = makeIr()
    const first = resolveVariables(ir, { serial: '001', partNo: 'ABC' })
    const second = resolveVariables(ir, { serial: '002', partNo: 'ABC' })
    const contentOf = (label: LabelIR, id: string): unknown => {
      const found = label.elements.find((e) => e.id === id)
      return found && 'content' in found ? found.content : null
    }
    expect(contentOf(first, 'code')).toBe('001')
    expect(contentOf(second, 'code')).toBe('002')
  })

  it('names the missing field when a value is absent', () => {
    expect(() => resolveVariables(makeIr(), { serial: '001' })).toThrow(MissingVariableError)
    try {
      resolveVariables(makeIr(), { serial: '001' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as MissingVariableError).fieldName).toBe('partNo')
    }
  })
})

describe('formatSequence', () => {
  it('zero-pads to the configured width', () => {
    expect(formatSequence('serial', 1, 3)).toBe('001')
    expect(formatSequence('serial', 38, 3)).toBe('038')
    expect(formatSequence('serial', 999, 3)).toBe('999')
  })

  it('refuses to wrap or truncate on overflow', () => {
    // Wrapping 1000 back to 000 would silently reissue serials that have
    // already been printed, which is the exact failure the feature prevents.
    expect(() => formatSequence('serial', 1000, 3)).toThrow(SequenceOverflowError)
  })

  it('reports the field, value and width on overflow', () => {
    try {
      formatSequence('serial', 1000, 3)
      expect.unreachable('should have thrown')
    } catch (err) {
      const overflow = err as SequenceOverflowError
      expect(overflow.fieldName).toBe('serial')
      expect(overflow.value).toBe(1000)
      expect(overflow.digits).toBe(3)
    }
  })

  it('rejects malformed input', () => {
    expect(() => formatSequence('serial', -1, 3)).toThrow()
    expect(() => formatSequence('serial', 1.5, 3)).toThrow()
    expect(() => formatSequence('serial', 1, 0)).toThrow()
  })
})
