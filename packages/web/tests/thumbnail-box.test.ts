import { describe, expect, it } from 'vitest'
import { thumbnailBoxPx } from '../src/features/templates/thumbnail-box.ts'

/**
 * The frame beside a template's title takes the label's shape.
 *
 * A single fixed frame cannot: a 100 x 10 strip letterboxed into a square is a
 * hairline in a mostly-empty box, and a portrait label in the same square is a
 * sliver. Taking the shape is what makes a glance tell you which way round the
 * design is.
 */
const limits = { maxWidthPx: 96, maxHeightPx: 56 }

describe('sizing the thumbnail frame', () => {
  it('never exceeds either limit', () => {
    for (const label of [
      { widthMm: 50, heightMm: 30 },
      { widthMm: 10, heightMm: 100 },
      { widthMm: 100, heightMm: 10 },
      { widthMm: 40, heightMm: 40 },
    ]) {
      const box = thumbnailBoxPx(label, limits)
      expect(box.widthPx).toBeLessThanOrEqual(limits.maxWidthPx)
      expect(box.heightPx).toBeLessThanOrEqual(limits.maxHeightPx)
    }
  })

  it('keeps the label proportions, so the card shows which way round it is', () => {
    const box = thumbnailBoxPx({ widthMm: 50, heightMm: 25 }, limits)
    expect(box.widthPx / box.heightPx).toBeCloseTo(2, 1)
  })

  it('lets width bind for a wide design', () => {
    // 100 x 10 is far wider than the budget allows; the width is what runs out.
    const box = thumbnailBoxPx({ widthMm: 100, heightMm: 10 }, limits)
    expect(box.widthPx).toBe(limits.maxWidthPx)
    expect(box.heightPx).toBeLessThan(limits.maxHeightPx)
  })

  it('lets height bind for a tall design', () => {
    const box = thumbnailBoxPx({ widthMm: 10, heightMm: 100 }, limits)
    expect(box.heightPx).toBe(limits.maxHeightPx)
    expect(box.widthPx).toBeLessThan(limits.maxWidthPx)
  })

  it('makes a square design square', () => {
    const box = thumbnailBoxPx({ widthMm: 40, heightMm: 40 }, limits)
    expect(box.widthPx).toBe(box.heightPx)
  })

  it('fills the budget rather than leaving a small design small', () => {
    // The frame is a card element, not a scale drawing: a 20 x 12 label gets
    // the same frame as a 50 x 30 one, because they are the same shape.
    expect(thumbnailBoxPx({ widthMm: 20, heightMm: 12 }, limits)).toEqual(
      thumbnailBoxPx({ widthMm: 50, heightMm: 30 }, limits),
    )
  })

  it('keeps an extreme ratio visible rather than letting it collapse', () => {
    const box = thumbnailBoxPx({ widthMm: 200, heightMm: 4 }, limits)
    expect(box.heightPx).toBeGreaterThanOrEqual(12)
  })

  it('returns whole pixels, since a half-pixel border reads as a rendering fault', () => {
    const box = thumbnailBoxPx({ widthMm: 37, heightMm: 23 }, limits)
    expect(Number.isInteger(box.widthPx)).toBe(true)
    expect(Number.isInteger(box.heightPx)).toBe(true)
  })

  it('does not produce NaN for a degenerate label', () => {
    const box = thumbnailBoxPx({ widthMm: 0, heightMm: 0 }, limits)
    expect(Number.isFinite(box.widthPx)).toBe(true)
    expect(Number.isFinite(box.heightPx)).toBe(true)
  })
})
