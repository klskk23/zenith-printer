/**
 * What a gallery thumbnail fills its variable fields with.
 *
 * The first row of the bound table when there is one, so the picture shows
 * a real label rather than `${货位号}`; the design's own standing values
 * otherwise, so the picture still appears. A column the row lacks is left
 * empty rather than shown as its placeholder — the placeholder would look
 * like content.
 */
import { describe, expect, it } from 'vitest'
import type { VariableDefinition } from '@zenith/shared'
import { thumbnailValues } from '../src/features/templates/thumbnail-values.ts'
import { designValues } from '../src/editor/preview-values.ts'

const variables: VariableDefinition[] = [{ kind: 'constant', name: '厂名', value: 'MIXLAKE' }]

describe('thumbnailValues', () => {
  it('takes the first row\'s values', () => {
    const values = thumbnailValues(variables, { 货位号: 'A-12-03', 条码: '6901234567892' })
    expect(values['货位号']).toBe('A-12-03')
    expect(values['条码']).toBe('6901234567892')
  })

  it('keeps the design\'s own constants beside the row', () => {
    expect(thumbnailValues(variables, { 货位号: 'A' })['厂名']).toBe('MIXLAKE')
  })

  it('lets a row value win over a constant of the same name', () => {
    // The same rule the print path applies; the picture should not disagree.
    expect(thumbnailValues(variables, { 厂名: 'OTHER' })['厂名']).toBe('OTHER')
  })

  it('falls back to the design values when there is no row', () => {
    expect(thumbnailValues(variables, undefined)).toEqual(designValues(variables))
  })

  it('leaves a missing column empty, not as a placeholder', () => {
    const values = thumbnailValues(variables, { 货位号: 'A' }, ['货位号', '条码'])
    expect(values['条码']).toBe('')
  })
})
