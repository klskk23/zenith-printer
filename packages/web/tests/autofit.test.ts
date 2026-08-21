/**
 * Fitting an element's box to its content.
 *
 * Both rules are checked against the renderer's own arithmetic rather than
 * against a remembered number, so that a change to how text is laid out breaks
 * this file instead of silently making the box wrong again.
 */
import { describe, expect, it } from 'vitest'
import { TEXT_LINE_HEIGHT, labelIrSchema, type LabelIR, type TextElement } from '@zenith/shared'
import { affectsTextBox, imageBoxMm, textBoxMm } from '../src/editor/autofit.ts'

const ir: LabelIR = labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements: [] })

function text(over: Partial<TextElement> = {}): TextElement {
  return {
    id: 'text-1',
    type: 'text',
    xMm: 2,
    yMm: 2,
    widthMm: 30,
    heightMm: 5,
    rotation: 0,
    content: 'Text',
    fontFamily: 'Noto Sans CJK SC',
    fontSizeMm: 3,
    bold: false,
    align: 'left',
    ...over,
  } as TextElement
}

/** A stand-in for glyph metrics: every character is half an em wide. */
const halfEm = (line: string): number => line.length * 0.5

describe('textBoxMm', () => {
  it('is one em tall for a single line', () => {
    // The renderer puts the first baseline exactly one em below the top edge,
    // so a one-line box is exactly the font size.
    expect(textBoxMm(text({ fontSizeMm: 3 }), halfEm).heightMm).toBeCloseTo(3, 6)
  })

  it('grows by the renderer’s own line height per extra line', () => {
    const one = textBoxMm(text({ content: 'a' }), halfEm).heightMm
    const three = textBoxMm(text({ content: 'a\nb\nc' }), halfEm).heightMm
    expect(three - one).toBeCloseTo(3 * TEXT_LINE_HEIGHT * 2, 6)
  })

  it('takes its width from the longest line, not the last one', () => {
    const box = textBoxMm(text({ content: 'a\nlonger line\nb' }), halfEm)
    expect(box.widthMm).toBeCloseTo('longer line'.length * 0.5 * 3, 6)
  })

  it('scales the width with the font size', () => {
    const small = textBoxMm(text({ fontSizeMm: 2 }), halfEm).widthMm
    const large = textBoxMm(text({ fontSizeMm: 6 }), halfEm).widthMm
    expect(large).toBeCloseTo(small * 3, 6)
  })

  /**
   * The state the editor is in whenever someone clears the field to retype it.
   * A zero-width box cannot be clicked, so the element would become
   * unselectable at exactly the moment the user is editing it.
   */
  it('keeps a grabbable box for empty content', () => {
    const box = textBoxMm(text({ content: '' }), halfEm)
    expect(box.widthMm).toBeGreaterThan(0)
    expect(box.heightMm).toBeGreaterThan(0)
  })

  it('replaces the declared box rather than fitting inside it', () => {
    // A new text element is 30 mm wide holding about 6 mm of glyphs; the point
    // of the exercise is that the 30 goes away.
    expect(textBoxMm(text(), halfEm).widthMm).toBeLessThan(10)
  })
})

describe('affectsTextBox', () => {
  it.each([
    ['content', { content: 'other' }],
    ['font size', { fontSizeMm: 5 }],
    ['font family', { fontFamily: 'DejaVu Sans Mono' }],
    ['weight', { bold: true }],
  ])('reports that %s changes the box', (_name, change) => {
    expect(affectsTextBox(text(), text(change))).toBe(true)
  })

  it.each([
    ['position', { xMm: 20 }],
    ['alignment', { align: 'center' as const }],
    ['rotation', { rotation: 90 as const }],
  ])('leaves the box alone when only %s changes', (_name, change) => {
    // Alignment moves the anchor within the box; it does not resize it. If
    // this returned true, the box would be refitted — and refitting on
    // alignment would silently discard a width the user set by hand.
    expect(affectsTextBox(text(), text(change))).toBe(false)
  })
})

describe('imageBoxMm', () => {
  it('gives the box the picture’s own proportions', () => {
    const box = imageBoxMm({ widthMm: 15, heightMm: 15 }, { width: 1600, height: 900 }, ir)
    expect(box.widthMm / box.heightMm).toBeCloseTo(1600 / 900, 6)
  })

  it('keeps the width the element already had, and moves the height to match', () => {
    // Replacing the file behind an element the user has sized: the width they
    // chose survives and only the proportion is corrected.
    const box = imageBoxMm({ widthMm: 20, heightMm: 4 }, { width: 200, height: 100 }, ir)
    expect(box.widthMm).toBeCloseTo(20, 6)
    expect(box.heightMm).toBeCloseTo(10, 6)
  })

  it('never produces an element taller than the label', () => {
    const box = imageBoxMm({ widthMm: 15, heightMm: 15 }, { width: 100, height: 1000 }, ir)
    expect(box.heightMm).toBeLessThanOrEqual(ir.heightMm)
    // Clamped by scaling, not by squashing: the proportions have to survive.
    expect(box.widthMm / box.heightMm).toBeCloseTo(0.1, 6)
  })

  it('never produces an element wider than the label', () => {
    const wide = labelIrSchema.parse({ widthMm: 10, heightMm: 30, dpi: 203, elements: [] })
    const box = imageBoxMm({ widthMm: 15, heightMm: 15 }, { width: 1000, height: 100 }, wide)
    expect(box.widthMm).toBeLessThanOrEqual(wide.widthMm)
    expect(box.widthMm / box.heightMm).toBeCloseTo(10, 6)
  })

  it('leaves the box alone when the picture has no size to speak of', () => {
    const current = { widthMm: 15, heightMm: 15 }
    expect(imageBoxMm(current, { width: 0, height: 0 }, ir)).toEqual(current)
  })

  /**
   * Callers spread the result over the element they passed in. Returning the
   * argument itself therefore spread the element back over itself — undoing
   * the assetId set in the same patch, so a successful upload left the element
   * pointing at no image at all.
   */
  it.each([
    ['a picture with no size', { width: 0, height: 0 }],
    ['a normal picture', { width: 200, height: 100 }],
  ])('returns only the box, never the element it was given (%s)', (_name, natural) => {
    const element = { widthMm: 15, heightMm: 15, assetId: 'img-1', id: 'image-1' }
    expect(Object.keys(imageBoxMm(element, natural, ir)).sort()).toEqual(['heightMm', 'widthMm'])
  })
})
