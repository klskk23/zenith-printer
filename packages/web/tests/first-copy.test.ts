/**
 * What the previewed label says.
 *
 * A batch's labels differ, so the preview shows the first — a label that will
 * genuinely be printed rather than a composite of none of them.
 */
import { describe, expect, it } from 'vitest'
import { firstCopyValues } from '../src/features/print/first-copy.ts'
import type { PrintFormField } from '../src/features/templates/hooks.ts'

const manual: PrintFormField = { name: 'sku', label: 'SKU', source: 'manual' }
const serial: PrintFormField = {
  name: 'serial',
  label: '流水号',
  source: 'sequence',
  suggestedStart: 41,
  seqDigits: 4,
  seqStep: 1,
}

describe('firstCopyValues', () => {
  it('is empty for a design with no variables at all', () => {
    expect(firstCopyValues({ fields: [], manualValues: {}, sequenceOverrides: {} })).toEqual({})
  })

  it('takes what the operator typed', () => {
    expect(
      firstCopyValues({ fields: [manual], manualValues: { sku: 'A-1' }, sequenceOverrides: {} }),
    ).toEqual({ sku: 'A-1' })
  })

  it('starts a sequence where the batch will start, not at one', () => {
    // The suggestion continues from what has already been printed; previewing
    // 0001 would show a label nobody is about to produce.
    expect(firstCopyValues({ fields: [serial], manualValues: {}, sequenceOverrides: {} })).toEqual({
      serial: '0041',
    })
  })

  it('honours an operator’s own start', () => {
    expect(
      firstCopyValues({ fields: [serial], manualValues: {}, sequenceOverrides: { serial: 7 } }),
    ).toEqual({ serial: '0007' })
  })

  it('pads to the field’s width', () => {
    const wide = { ...serial, seqDigits: 6 }
    expect(
      firstCopyValues({ fields: [wide], manualValues: {}, sequenceOverrides: { serial: 7 } }),
    ).toEqual({ serial: '000007' })
  })

  /**
   * Null rather than a partial map: a label rendered with a hole where a field
   * should be is a preview of something that will never print.
   */
  it.each([
    ['nothing typed', {}],
    ['an empty string', { sku: '' }],
  ])('says it cannot preview yet when a manual field has %s', (_name, manualValues) => {
    expect(firstCopyValues({ fields: [manual], manualValues, sequenceOverrides: {} })).toBeNull()
  })

  it('does not wait on a sequence, which always has a value', () => {
    expect(
      firstCopyValues({ fields: [manual, serial], manualValues: { sku: 'A-1' }, sequenceOverrides: {} }),
    ).toEqual({ sku: 'A-1', serial: '0041' })
  })
})
