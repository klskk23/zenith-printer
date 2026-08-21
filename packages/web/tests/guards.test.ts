import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import {
  blockingViolations,
  boundsOf,
  canPrint,
  canvasDots,
  dotStepMm,
  inspect,
  isOutOfBounds,
  maxCanvasWidthMm,
  minStrokeWidthMm,
  snapMm,
} from '../src/editor/guards.ts'

/** B3S_P as probed. */
const LIMITS = { dpi: 203, printheadPixels: 576 }

function label(elements: unknown[], overrides: Partial<LabelIR> = {}): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements, ...overrides })
}

const rule = { id: 'l', type: 'line', xMm: 2, yMm: 10, x2Mm: 40, y2Mm: 10, strokeWidthDots: 1 }

describe('printer limits', () => {
  it('derives the canvas width limit from the printhead', () => {
    expect(maxCanvasWidthMm(LIMITS)).toBeCloseTo(72.071, 3)
  })

  it('derives the minimum stroke from dpi', () => {
    expect(minStrokeWidthMm(LIMITS)).toBeCloseTo(0.125, 3)
  })
})

describe('canvas width', () => {
  it('blocks a canvas wider than the printhead', () => {
    // FR-005: the device clips silently, so the editor has to refuse.
    const violations = inspect(label([], { widthMm: 90 }), LIMITS)
    expect(violations[0]?.code).toBe('CANVAS_TOO_WIDE')
    expect(violations[0]?.blocking).toBe(true)
  })

  it('reports the limit alongside the offending width', () => {
    const violation = inspect(label([], { widthMm: 90 }), LIMITS)[0]
    expect(violation?.values).toMatchObject({ widthMm: 90, maxWidthMm: 72.07 })
  })

  it('accepts a canvas at the limit', () => {
    expect(inspect(label([], { widthMm: 72 }), LIMITS)).toHaveLength(0)
  })
})

describe('out of bounds', () => {
  it('marks rather than blocks', () => {
    // Dragging briefly past the edge is normal; a modal here would be
    // intolerable to use.
    const violations = inspect(label([{ ...rule, x2Mm: 80 }]), LIMITS)
    expect(violations[0]?.code).toBe('ELEMENT_OUT_OF_BOUNDS')
    expect(violations[0]?.blocking).toBe(false)
  })

  it('still allows printing when only marks remain', () => {
    expect(canPrint(label([{ ...rule, x2Mm: 80 }]), LIMITS)).toBe(true)
  })

  it('detects overflow on every edge', () => {
    const cases = [
      { ...rule, xMm: -1 },
      { ...rule, yMm: -1, y2Mm: -1 },
      { ...rule, x2Mm: 60 },
      { ...rule, yMm: 40, y2Mm: 40 },
    ]
    for (const element of cases) {
      expect(isOutOfBounds(labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements: [element] }).elements[0]!, label([]))).toBe(true)
    }
  })

  it('accepts an element flush against the edge', () => {
    const ir = label([{ id: 'r', type: 'rect', xMm: 0, yMm: 0, widthMm: 50, heightMm: 30, strokeWidthDots: 1 }])
    expect(isOutOfBounds(ir.elements[0]!, ir)).toBe(false)
  })
})

describe('stroke width', () => {
  it('blocks a sub-dot stroke', () => {
    // Schema-level rejection already covers this, but the editor must explain
    // it before the user gets an opaque validation error.
    const ir = { ...label([]), elements: [{ ...rule, strokeWidthDots: 0 } as never] }
    const violations = inspect(ir as LabelIR, LIMITS)
    expect(violations.some((v) => v.code === 'STROKE_TOO_THIN' && v.blocking)).toBe(true)
  })

  it('accepts one whole dot', () => {
    expect(inspect(label([rule]), LIMITS)).toHaveLength(0)
  })
})

describe('barcode content', () => {
  it('blocks an empty barcode', () => {
    const ir = {
      ...label([]),
      elements: [
        { id: 'b', type: 'barcode', xMm: 1, yMm: 1, widthMm: 20, heightMm: 10, rotation: 0, content: '', symbology: 'code128', showHumanReadable: true } as never,
      ],
    }
    expect(inspect(ir as LabelIR, LIMITS).some((v) => v.code === 'BARCODE_CONTENT_EMPTY')).toBe(true)
  })

  it('does not judge an unresolved variable reference', () => {
    // The value arrives at print time; emptiness cannot be decided here.
    const ir = label([
      { id: 'b', type: 'barcode', xMm: 1, yMm: 1, widthMm: 20, heightMm: 10, content: { $var: 'serial' }, symbology: 'code128' },
    ])
    expect(inspect(ir, LIMITS)).toHaveLength(0)
  })
})

describe('ordering', () => {
  it('puts blocking problems first', () => {
    const ir = label([{ ...rule, x2Mm: 80 }], { widthMm: 90 })
    const violations = inspect(ir, LIMITS)
    expect(violations[0]?.blocking).toBe(true)
    expect(blockingViolations(violations)).toHaveLength(1)
  })
})

describe('dot grid', () => {
  it('snaps a millimetre value onto a whole dot', () => {
    expect(snapMm(10.3, 203)).toBeCloseTo((Math.round((10.3 * 203) / 25.4) * 25.4) / 203, 9)
  })

  it('reports one dot as the nudge increment', () => {
    expect(dotStepMm(203)).toBeCloseTo(0.125, 3)
  })

  it('reports the canvas size in whole dots', () => {
    expect(canvasDots(label([]))).toEqual({ widthDots: 400, heightDots: 240 })
  })
})

describe('bounds', () => {
  it('normalises a line drawn right-to-left', () => {
    const ir = label([{ id: 'l', type: 'line', xMm: 40, yMm: 5, x2Mm: 10, y2Mm: 5, strokeWidthDots: 1 }])
    expect(boundsOf(ir.elements[0]!)).toMatchObject({ xMm: 10, widthMm: 30 })
  })

  it('uses width and height for boxed elements', () => {
    const ir = label([{ id: 'r', type: 'rect', xMm: 3, yMm: 4, widthMm: 20, heightMm: 10, strokeWidthDots: 1 }])
    expect(boundsOf(ir.elements[0]!)).toEqual({ xMm: 3, yMm: 4, widthMm: 20, heightMm: 10 })
  })
})
