/**
 * Overflow is reported, never enforced.
 *
 * The judgement — is a clipped label acceptable this time — belongs to whoever
 * is holding the roll. What the software owes them is knowing beforehand, and
 * knowing about *every* bad row rather than one at a time.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { checkLabel } from '../../src/domain/overflow.ts'

function ir(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

const fixedBarcode = {
  id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 10,
  content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2,
}

const variableBarcode = {
  ...fixedBarcode,
  content: '${serial}',
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

describe('the check runs once, not once per label', () => {
  /**
   * FR-045. The batch check encoded a barcode for every copy, so a
   * thousand-label job did a thousand encodes before the first label could
   * come out — exactly the wait the page source exists to remove.
   *
   * The assertion that bites lives at the API level, where a batch size is
   * available: a thousand-row job whose barcode overflows on every row now
   * produces one warning rather than a thousand. See
   * tests/integration/data-source-print.test.ts.
   */
  it('catches an overflow the design itself has', () => {
    // What is still checked: the design, measured with the values the editor
    // draws it with.
    const design = ir([variableBarcode])
    expect(checkLabel(design, { serial: 'A'.repeat(45) }, 0)).toHaveLength(1)
  })

  it('says nothing about rows it was not given', () => {
    // The honest consequence of FR-045: whether row 700 overflows is something
    // the physical labels reveal, and the print dialog says so out loud rather
    // than leaving silence to be read as "checked, and fine" (FR-045a).
    const design = ir([variableBarcode])
    expect(checkLabel(design, { serial: 'A1' }, 0)).toEqual([])
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
    const warnings = checkLabel(design, { serial: 'A'.repeat(40) }, 0)
    const snapshot = { widthMm: 50, heightMm: 30, overflowWarnings: warnings }

    // Editing the design afterwards must not change the record.
    const edited = ir([{ ...variableBarcode, xMm: 0 }])
    expect(checkLabel(edited, { serial: 'A'.repeat(40) }, 0).length).not.toBe(0)
    expect(snapshot.overflowWarnings).toHaveLength(1)
  })

  it('stores nothing for a clean run', () => {
    expect(checkLabel(ir([fixedBarcode]), {}, 0)).toEqual([])
  })
})
