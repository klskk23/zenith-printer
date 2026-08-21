/**
 * Overflow is reported, never enforced.
 *
 * The judgement — is a clipped label acceptable this time — belongs to whoever
 * is holding the roll. What the software owes them is knowing beforehand, and
 * knowing about *every* bad row rather than one at a time.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { checkBatch, checkLabel } from '../../src/domain/overflow.ts'

function ir(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

const fixedBarcode = {
  id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 10,
  content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2,
}

const variableBarcode = {
  ...fixedBarcode,
  content: { $var: 'serial' },
}

describe('a label that fits', () => {
  it('reports nothing', () => {
    expect(checkLabel(ir([fixedBarcode]), {}, 0)).toEqual([])
  })

  it('reports nothing for an element exactly at the edge', () => {
    const rect = { id: 'r', type: 'rect', xMm: 0, yMm: 0, widthMm: 50, heightMm: 30, strokeWidthDots: 1 }
    expect(checkLabel(ir([rect]), {}, 0)).toEqual([])
  })
})

describe('a label that does not', () => {
  it('catches an element hanging off the edge', () => {
    const rect = { id: 'r', type: 'rect', xMm: 45, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 1 }
    const warnings = checkLabel(ir([rect]), {}, 0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ elementId: 'r', reason: 'ELEMENT_OUT_OF_BOUNDS', rowIndex: 0 })
  })

  it('catches an element pushed off by rotation', () => {
    // 40 wide lying down, 40 tall standing up — and the label is 30 tall.
    const rotated = { ...fixedBarcode, rotation: 90, yMm: 2 }
    expect(checkLabel(ir([rotated]), {}, 0).some((w) => w.reason === 'ELEMENT_OUT_OF_BOUNDS')).toBe(true)
  })

  it('names the element, so the row can be acted on', () => {
    const rect = { id: 'the-box', type: 'rect', xMm: 45, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 1 }
    expect(checkLabel(ir([rect]), {}, 3)[0]).toMatchObject({ elementId: 'the-box', rowIndex: 3 })
  })
})

/**
 * FR-069 and SC-011. A barcode bound to a field has no fixed width: it is
 * moduleWidth x moduleCount, and the module count follows the content. This is
 * the case the design-time check cannot see.
 */
describe('variable content', () => {
  const design = ir([variableBarcode])

  it('passes a short value', () => {
    expect(checkLabel(design, { serial: 'A1' }, 0)).toEqual([])
  })

  it('catches a value long enough to overflow', () => {
    const warnings = checkLabel(design, { serial: 'A'.repeat(40) }, 0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ reason: 'BARCODE_TOO_WIDE' })
  })

  it('reports both the actual and the available width', () => {
    const warning = checkLabel(design, { serial: 'A'.repeat(40) }, 0)[0]!
    expect(warning.actualWidthMm).toBeGreaterThan(warning.availableWidthMm)
  })

  it('says nothing about content that cannot be encoded at all', () => {
    // A different fault with its own check; two complaints about one problem
    // is worse than one.
    expect(checkLabel(ir([{ ...variableBarcode, symbology: 'ean13' }]), { serial: 'not-a-number' }, 0))
      .toEqual([])
  })
})

describe('a batch', () => {
  const design = ir([variableBarcode])
  const serials = ['A1', 'B2', 'A'.repeat(40), 'D4', 'A'.repeat(45)]
  const valuesFor = (row: number): Record<string, string> => ({ serial: serials[row] ?? 'A1' })

  it('checks every row, not just the first', () => {
    const warnings = checkBatch(design, valuesFor, serials.length)
    expect(warnings.map((w) => w.rowIndex)).toEqual([2, 4])
  })

  it('reports all bad rows at once, so they can be fixed in one pass', () => {
    expect(checkBatch(design, valuesFor, serials.length)).toHaveLength(2)
  })

  it('returns nothing for a clean batch', () => {
    expect(checkBatch(design, () => ({ serial: 'A1' }), 100)).toEqual([])
  })

  it('scales to a full hundred-label run', () => {
    const warnings = checkBatch(design, (row) => ({ serial: row === 99 ? 'A'.repeat(40) : 'A1' }), 100)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.rowIndex).toBe(99)
  })
})

/**
 * FR-067 as a negative assertion. Overflow produces warnings and nothing else:
 * there is no failure code for it, and no code path that turns one into a
 * rejection. This exists because "just block the bad ones" is a tempting change
 * to make later.
 */
describe('overflow is not a failure', () => {
  it('returns data rather than throwing', () => {
    const rect = { id: 'r', type: 'rect', xMm: 45, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 1 }
    expect(() => checkLabel(ir([rect]), {}, 0)).not.toThrow()
  })

  it('has no severity field to escalate', () => {
    const rect = { id: 'r', type: 'rect', xMm: 45, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 1 }
    expect(Object.keys(checkLabel(ir([rect]), {}, 0)[0]!)).not.toContain('blocking')
  })
})

/**
 * FR-091. The design can be edited or deleted after a run, so "what was
 * clipped" has to be stored with the job rather than worked out again later.
 */
describe('what history keeps', () => {
  it('carries warnings on the snapshot, not by reference to the design', () => {
    const design = ir([variableBarcode])
    const warnings = checkBatch(design, () => ({ serial: 'A'.repeat(40) }), 2)
    const snapshot = { widthMm: 50, heightMm: 30, overflowWarnings: warnings }

    // Editing the design afterwards must not change the record.
    const edited = ir([{ ...variableBarcode, xMm: 0 }])
    expect(checkBatch(edited, () => ({ serial: 'A'.repeat(40) }), 2).length)
      .not.toBe(0)
    expect(snapshot.overflowWarnings).toHaveLength(2)
  })

  it('keeps one entry per affected row', () => {
    const design = ir([variableBarcode])
    expect(checkBatch(design, () => ({ serial: 'A'.repeat(40) }), 3)).toHaveLength(3)
  })

  it('stores nothing for a clean run', () => {
    expect(checkBatch(ir([fixedBarcode]), () => ({}), 5)).toEqual([])
  })
})
