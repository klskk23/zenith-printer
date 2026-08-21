/**
 * Which fields the print dialog asks about, and where each answer comes from.
 */
import { describe, expect, it } from 'vitest'
import { needsSavingForSequences, printFormFields } from '../src/features/print/print-form-fields.ts'
import type { PrintFormField, VariableField } from '../src/features/templates/hooks.ts'

const manual: VariableField = { name: 'sku', label: 'SKU', source: 'manual', sampleValue: 'A-1' }
const serial: VariableField = {
  name: 'serial',
  label: '流水号',
  source: 'sequence',
  seqStart: 1,
  seqDigits: 4,
  seqStep: 1,
}

describe('with nothing from the server', () => {
  /**
   * The case that was broken. An unsaved design has no template, so the print
   * form endpoint is never called — and the dialog offered nothing to fill in,
   * so the preview asked the server to resolve a `$var` it had no value for
   * and came back as "could not render".
   */
  it('asks about the design’s own fields', () => {
    expect(printFormFields([manual], []).map((f) => f.name)).toEqual(['sku'])
  })

  it('keeps the sample the author wrote', () => {
    expect(printFormFields([manual], [])[0]?.sampleValue).toBe('A-1')
  })

  it('starts a sequence where the design says', () => {
    expect(printFormFields([serial], [])[0]?.suggestedStart).toBe(1)
  })
})

describe('with a saved template behind it', () => {
  /**
   * Where a sequence has got to lives in the claims, not in the design. It is
   * the one thing the editor cannot work out, and getting it wrong means the
   * next batch reprints numbers already on labels.
   */
  it('takes the server’s continuation over the design’s starting point', () => {
    const fromServer: PrintFormField = {
      name: 'serial',
      label: '流水号',
      source: 'sequence',
      suggestedStart: 741,
      seqDigits: 4,
      seqStep: 1,
    }
    expect(printFormFields([serial], [fromServer])[0]?.suggestedStart).toBe(741)
  })

  it('carries the server’s ceiling through', () => {
    const fromServer: PrintFormField = { ...serial, suggestedStart: 5, maxRepresentable: 9999 }
    expect(printFormFields([serial], [fromServer])[0]?.maxRepresentable).toBe(9999)
  })

  /**
   * The design decides which fields exist. A field added since the last save
   * has to be askable, or an edited template cannot be printed — and edits now
   * do print, because the design goes with the job.
   */
  it('includes a field the template has not been saved with yet', () => {
    expect(printFormFields([manual, serial], [{ ...serial, suggestedStart: 9 }]).map((f) => f.name)).toEqual([
      'sku',
      'serial',
    ])
  })

  it('drops a field the design no longer has', () => {
    // The stored template still lists it; the design being printed does not.
    expect(printFormFields([manual], [{ ...serial, suggestedStart: 9 }]).map((f) => f.name)).toEqual(['sku'])
  })

  it('keeps the labels the design uses', () => {
    const renamed = { ...manual, label: '物料号' }
    expect(printFormFields([renamed], [{ ...manual, label: 'SKU' } as PrintFormField])[0]?.label).toBe('物料号')
  })
})

describe('sequences on an unsaved design', () => {
  /**
   * A sequence claim is recorded against a template, because its purpose is to
   * carry on across print runs and there is nothing for an unsaved design to
   * carry on from. Submitting one produces a job that fails in the queue,
   * which is a wasted trip and a confusing place to find out.
   */
  it('needs saving first', () => {
    expect(needsSavingForSequences([serial], null)).toBe(true)
  })

  it('does not once the template is saved', () => {
    expect(needsSavingForSequences([serial], 'tpl-1')).toBe(false)
  })

  it('does not for manual fields, which need nothing persistent', () => {
    expect(needsSavingForSequences([manual], null)).toBe(false)
  })

  it('does not for a design with no variables at all', () => {
    expect(needsSavingForSequences([], null)).toBe(false)
  })
})
