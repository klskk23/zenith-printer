import { describe, expect, it } from 'vitest'
import { irToSvg, type LabelIR } from '@zenith/shared'
import { clampOrdinal, designValues, previewIr } from '../src/editor/preview-values.ts'

/**
 * What the canvas draws while a design is being written.
 *
 * The governing rule is that none of this may throw. A design mid-edit is full
 * of states that are not printable — half-typed references, names that were
 * defined a moment ago and are not any more — and the editor has to survive
 * every one of them. It used to blank the screen instead.
 */
function ir(...contents: string[]): LabelIR {
  return {
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: contents.map((content, index) => ({
      id: `e${index}`,
      type: 'text' as const,
      xMm: 1,
      yMm: 1 + index * 6,
      widthMm: 40,
      heightMm: 5,
      rotation: 0 as const,
      content,
      fontFamily: 'F',
      fontSizeMm: 3,
      bold: false,
      inverted: false,
      align: 'left' as const,
    })),
  }
}

const textOf = (result: LabelIR, index = 0): string => {
  const element = result.elements[index]
  return element !== undefined && 'content' in element ? element.content : ''
}

describe('designValues', () => {
  it('gives a constant its value', () => {
    expect(designValues([{ name: 'sku', kind: 'constant', value: 'ABC-123' }])).toEqual({ sku: 'ABC-123' })
  })

  it('shows a sequence as the number the next label would carry, padded', () => {
    // Padded because the padded form is what the layout has to accommodate:
    // "0001" is wider than "1", and the box is fitted to what it will say.
    const values = designValues([{ name: 'serial', kind: 'sequence', poolId: 'p1' }], {
      p1: { value: 742, digits: 6 },
    })
    expect(values.serial).toBe('000742')
  })

  it('falls back to 1 before the pool has loaded', () => {
    expect(designValues([{ name: 'serial', kind: 'sequence', poolId: 'p1' }]).serial).toBe('1')
  })
})

describe('previewIr', () => {
  it('substitutes a defined constant', () => {
    const result = previewIr(ir('零件 ${sku} 号'), { sku: 'ABC-123' })
    expect(textOf(result.ir)).toBe('零件 ABC-123 号')
    expect(result.unresolved).toEqual([])
  })

  it('draws an undefined reference verbatim and reports it', () => {
    // Drawing it as blank would look like the element is broken.
    const result = previewIr(ir('${nope}'), {})
    expect(textOf(result.ir)).toBe('${nope}')
    expect(result.unresolved).toEqual(['nope'])
  })

  it('survives every intermediate state of typing ${sku}', () => {
    // SC-006. This is the sequence that used to blank the editor: binding an
    // element threw out of React's render pass.
    const values = { sku: 'ABC-123' }
    for (const partial of ['$', '${', '${s', '${sk', '${sku', '${sku}']) {
      expect(() => previewIr(ir(partial), values)).not.toThrow()
      expect(() => irToSvg(previewIr(ir(partial), values).ir)).not.toThrow()
    }
  })

  it('reports nothing for the half-typed states, only for the finished one', () => {
    // An error that flashes on the way to a valid reference is noise, and
    // noise that appears on every keystroke gets ignored.
    for (const partial of ['$', '${', '${s', '${sk', '${sku']) {
      expect(previewIr(ir(partial), {}).unresolved).toEqual([])
    }
    expect(previewIr(ir('${sku}'), {}).unresolved).toEqual(['sku'])
  })

  it('keeps a version string with a dot in it as two references', () => {
    const result = previewIr(ir('版本 ${major}.${minor}'), { major: '2', minor: '7' })
    expect(textOf(result.ir)).toBe('版本 2.7')
  })

  it('renders an escaped dollar as one dollar', () => {
    expect(textOf(previewIr(ir('$$${price}'), { price: '19.90' }).ir)).toBe('$19.90')
  })

  it('leaves the stored IR untouched, references and all', () => {
    // Otherwise an edit made while looking at a substituted value writes the
    // value back and the reference is lost.
    const source = ir('${sku}')
    previewIr(source, { sku: 'ABC-123' })
    expect(textOf(source)).toBe('${sku}')
  })

  it('reports each unresolved name once, across elements', () => {
    const result = previewIr(ir('${a}', '${b} ${a}'), {})
    expect(result.unresolved).toEqual(['a', 'b'])
  })

  it('does not report an element type that carries no content', () => {
    const withLine: LabelIR = {
      ...ir('${sku}'),
      elements: [
        { id: 'l', type: 'line', xMm: 0, yMm: 0, x2Mm: 10, y2Mm: 0, rotation: 0, strokeWidthDots: 1, inverted: false },
      ],
    }
    expect(previewIr(withLine, {}).unresolved).toEqual([])
  })
})

/**
 * Which row of the bound table the canvas stands in for.
 *
 * The failure it guards is silent: asking for a row past the end returns an
 * empty page, every `${列名}` renders blank, and the canvas looks like a design
 * that has lost its binding rather than a number field that is out of range.
 */
describe('clampOrdinal', () => {
  it('keeps a row inside the table', () => {
    expect(clampOrdinal(2, 3)).toBe(2)
  })

  it('holds at the last row rather than asking for one past it', () => {
    // What a refresh that shortened the table leaves behind.
    expect(clampOrdinal(9, 3)).toBe(3)
  })

  it('holds at the first rather than asking for row zero', () => {
    // What an emptied number field produces: Number('') is 0.
    expect(clampOrdinal(0, 3)).toBe(1)
    expect(clampOrdinal(-4, 3)).toBe(1)
  })

  it('survives a field that is not a number at all', () => {
    expect(clampOrdinal(Number.NaN, 3)).toBe(1)
  })

  it('answers 1 when there is no table, so nothing has to special-case it', () => {
    expect(clampOrdinal(1, 0)).toBe(1)
  })

  it('does not invent a fractional row', () => {
    expect(clampOrdinal(2.7, 5)).toBe(2)
  })
})
