/**
 * Where a label falls on the print head.
 *
 * Two numbers in, two fractions out: how much of the head the label covers,
 * and how much of the label hangs off it. The figure the print dialog draws
 * is nothing but these, so they are decided here and not in the SVG.
 */
import { describe, expect, it } from 'vitest'
import { headFigure, maxWidthFromCapabilities } from '../src/features/print/head-figure.ts'

describe('maxWidthFromCapabilities', () => {
  it('is the head width in millimetres', () => {
    // 384 dots at 203 dpi: the B1/B3S family. Same arithmetic as the server's
    // maxLabelWidthMm, so the two never disagree about what fits.
    expect(maxWidthFromCapabilities({ printheadPixels: 384, dpi: 203 })).toBeCloseTo(48.05, 2)
  })

  it('is unknown for a printer never probed', () => {
    expect(maxWidthFromCapabilities(null)).toBeNull()
  })
})

describe('headFigure', () => {
  it('places a label that fits', () => {
    const figure = headFigure({ labelWidthMm: 40, maxWidthMm: 48 })
    expect(figure).not.toBeNull()
    expect(figure!.labelFraction).toBeCloseTo(40 / 48, 5)
    expect(figure!.overflowFraction).toBe(0)
    expect(figure!.overflowMm).toBe(0)
  })

  it('shows how much of a wide label hangs off', () => {
    const figure = headFigure({ labelWidthMm: 100, maxWidthMm: 48 })!
    expect(figure.labelFraction).toBe(1)
    expect(figure.overflowFraction).toBeCloseTo(52 / 100, 5)
    expect(figure.overflowMm).toBe(52)
  })

  it('fills the head exactly at the limit', () => {
    const figure = headFigure({ labelWidthMm: 48, maxWidthMm: 48 })!
    expect(figure.labelFraction).toBe(1)
    expect(figure.overflowFraction).toBe(0)
  })

  it('draws nothing for a head of no width', () => {
    expect(headFigure({ labelWidthMm: 40, maxWidthMm: 0 })).toBeNull()
    expect(headFigure({ labelWidthMm: 40, maxWidthMm: null })).toBeNull()
  })

  it('rounds the overflow to a tenth of a millimetre for display', () => {
    expect(headFigure({ labelWidthMm: 50, maxWidthMm: 48.05 })!.overflowMm).toBe(2)
  })
})
