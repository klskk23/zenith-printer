import { describe, expect, it } from 'vitest'
import {
  UnresolvedVariableError,
  collectReferences,
  detectNameCollisions,
  evaluate,
  evaluateIrStrict,
} from '../src/template/evaluate.ts'
import type { LabelIR } from '../src/ir/schema.ts'

const VALUES = { sku: 'ABC-123', serial: '0007', '单价.含税': '19.90' }

describe('evaluate', () => {
  it('substitutes a resolvable reference', () => {
    expect(evaluate('零件 ${sku} 号', VALUES)).toEqual({ text: '零件 ABC-123 号', unresolved: [] })
  })

  it('substitutes a name containing dots', () => {
    expect(evaluate('${单价.含税}', VALUES).text).toBe('19.90')
  })

  it('emits an unterminated reference verbatim and does NOT call it unresolved', () => {
    // Mid-keystroke. Reporting it would make the editor flash an error on the
    // way to a perfectly valid reference.
    expect(evaluate('${sk', VALUES)).toEqual({ text: '${sk', unresolved: [] })
  })

  it('emits a closed but undefined reference verbatim AND reports it', () => {
    expect(evaluate('${nope}', VALUES)).toEqual({ text: '${nope}', unresolved: ['nope'] })
  })

  it('reports an empty name as unresolved', () => {
    expect(evaluate('${}', VALUES).unresolved).toEqual([''])
  })

  it('reports each distinct unresolved name once', () => {
    expect(evaluate('${a}${b}${a}', VALUES).unresolved).toEqual(['a', 'b'])
  })

  it('resolves a value that is itself empty without calling it unresolved', () => {
    // An empty cell is a value. Whether an empty barcode is acceptable is a
    // separate question, answered at submit time.
    expect(evaluate('${blank}', { blank: '' })).toEqual({ text: '', unresolved: [] })
  })

  it('does not re-scan substituted text', () => {
    // Otherwise a cell containing "${sku}" would expand, and a data source
    // could reach into the design's variables.
    expect(evaluate('${a}', { a: '${sku}', sku: 'ABC' }).text).toBe('${sku}')
  })

  it('never throws, whatever the input', () => {
    for (const input of ['${', '$', '${}', '${ }', '${a', '$${', '}}}']) {
      expect(() => evaluate(input, VALUES)).not.toThrow()
    }
  })
})

function ir(...contents: string[]): LabelIR {
  return {
    version: 1,
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: contents.map((content, index) => ({
      id: `e${index}`,
      type: 'text' as const,
      xMm: 0,
      yMm: 0,
      widthMm: 10,
      heightMm: 5,
      rotation: 0 as const,
      content,
      fontFamily: 'sans',
      fontSizeMm: 3,
      align: 'left' as const,
      bold: false,
    })),
  }
}

describe('collectReferences', () => {
  it('gathers every closed reference across elements, de-duplicated and ordered', () => {
    expect(collectReferences(ir('${a} ${b}', '${a}', 'plain'))).toEqual(['a', 'b'])
  })

  it('ignores unterminated references', () => {
    expect(collectReferences(ir('${a', '${b}'))).toEqual(['b'])
  })

  it('returns nothing for content without references', () => {
    expect(collectReferences(ir('plain text', '$100'))).toEqual([])
  })
})

describe('detectNameCollisions', () => {
  it('reports a constant that shares a name with a column', () => {
    // Silent precedence is the defect that appears when somebody adds a column
    // — and the person adding it has no way to know what they shadowed.
    expect(detectNameCollisions([{ name: 'sku', kind: 'constant', value: 'X' }], ['sku', '收件人'])).toEqual(['sku'])
  })

  it('reports a sequence variable that shares a name with a column', () => {
    expect(detectNameCollisions([{ name: '流水', kind: 'sequence', poolId: 'p1' }], ['流水'])).toEqual(['流水'])
  })

  it('is silent when the namespaces do not overlap', () => {
    expect(detectNameCollisions([{ name: 'sku', kind: 'constant', value: 'X' }], ['收件人'])).toEqual([])
  })

  it('is silent when there is no bound data source', () => {
    expect(detectNameCollisions([{ name: 'sku', kind: 'constant', value: 'X' }], [])).toEqual([])
  })
})

describe('evaluateIrStrict', () => {
  it('returns an evaluated IR when everything resolves', () => {
    const result = evaluateIrStrict(ir('零件 ${sku}'), VALUES)
    expect(result.elements[0]).toMatchObject({ content: '零件 ABC-123' })
  })

  it('refuses rather than drawing a placeholder onto stock', () => {
    // A label that comes out reading "${sku}" is waste that looks like output.
    expect(() => evaluateIrStrict(ir('${sku}', '${nope}'), VALUES)).toThrow(UnresolvedVariableError)
  })

  it('names every unresolved reference so the message can say which', () => {
    try {
      evaluateIrStrict(ir('${a}${b}'), VALUES)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as UnresolvedVariableError).names).toEqual(['a', 'b'])
    }
  })

  it('does NOT mistake escaped text for an unresolved reference', () => {
    // `$${sku}` evaluates to the literal characters "${sku}". A guard that
    // scanned the output would reject a perfectly valid label here.
    expect(() => evaluateIrStrict(ir('$${sku}'), VALUES)).not.toThrow()
    expect(evaluateIrStrict(ir('$${sku}'), VALUES).elements[0]).toMatchObject({ content: '${sku}' })
  })

  it('lets an unterminated reference through untouched', () => {
    expect(() => evaluateIrStrict(ir('${sk'), VALUES)).not.toThrow()
  })
})
