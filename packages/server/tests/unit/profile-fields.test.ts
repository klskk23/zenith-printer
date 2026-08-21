/**
 * What a profile describes: the paper.
 *
 * Position correction is deliberately absent — it moved to the printer, because
 * it says where *the machine* lays ink down and changes on every roll reload,
 * even a roll of the identical type. Keeping it here meant re-entering it per
 * profile and having a profile switch silently move the print.
 */
import { describe, expect, it } from 'vitest'
import { profileInputSchema } from '../../src/domain/profile.ts'

const base = {
  name: 'original stock',
  density: 3,
  labelType: 1,
  labelWidthMm: 50,
  labelHeightMm: 30,
}

describe('stock dimensions', () => {
  it('accepts a well-formed profile', () => {
    expect(() => profileInputSchema.parse(base)).not.toThrow()
  })

  it('requires the stock size, since the canvas follows it', () => {
    expect(() => profileInputSchema.parse({ ...base, labelWidthMm: undefined })).toThrow()
    expect(() => profileInputSchema.parse({ ...base, labelHeightMm: undefined })).toThrow()
  })

  it.each([0, -5])('rejects a width of %i', (labelWidthMm) => {
    expect(() => profileInputSchema.parse({ ...base, labelWidthMm })).toThrow()
  })
})

describe('margins', () => {
  it('defaults every side to zero', () => {
    expect(profileInputSchema.parse(base)).toMatchObject({
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
    })
  })

  it('accepts four independent values', () => {
    const parsed = profileInputSchema.parse({
      ...base, marginTopMm: 1, marginRightMm: 2, marginBottomMm: 3, marginLeftMm: 4,
    })
    expect(parsed).toMatchObject({ marginTopMm: 1, marginRightMm: 2, marginBottomMm: 3, marginLeftMm: 4 })
  })

  it('rejects a negative margin', () => {
    expect(() => profileInputSchema.parse({ ...base, marginTopMm: -1 })).toThrow()
  })

  it('rejects horizontal margins that leave no printable width', () => {
    expect(() => profileInputSchema.parse({ ...base, marginLeftMm: 30, marginRightMm: 30 })).toThrow()
  })

  it('rejects vertical margins that leave no printable height', () => {
    expect(() => profileInputSchema.parse({ ...base, marginTopMm: 20, marginBottomMm: 20 })).toThrow()
  })

  it('allows margins that leave a sliver', () => {
    expect(() => profileInputSchema.parse({ ...base, marginLeftMm: 24, marginRightMm: 24 })).not.toThrow()
  })
})

describe('what a profile no longer carries', () => {
  it('has no offset fields', () => {
    const parsed = profileInputSchema.parse({ ...base, offsetXMm: 5, offsetYMm: 5 })
    // Stripped rather than stored: an offset here would be re-entered per
    // profile and would move the print when profiles were switched.
    expect(parsed).not.toHaveProperty('offsetXMm')
    expect(parsed).not.toHaveProperty('offsetYMm')
  })
})
