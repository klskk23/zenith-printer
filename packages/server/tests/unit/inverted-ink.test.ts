/**
 * Drawing in white instead of black.
 *
 * For text or a rule sitting inside a black band. Nothing is composited: the
 * element supplies the ink, the black comes from a filled rect underneath, and
 * a white element on bare paper is invisible — which is the honest result of
 * asking for it.
 *
 * Rasterised rather than string-matched: what matters is that the white
 * survives rendering *and* the binarisation the printer path applies, where a
 * near-white would be thresholded back to paper.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { irToSvg, labelIrSchema, type LabelIR } from '@zenith/shared'
import { loadFontConfig } from '../../src/render/fonts.ts'

const repoRoot = join(import.meta.dirname, '../../../..')

/** A black band with one element on top of it. */
const onBlackBand = (element: Record<string, unknown>): LabelIR =>
  labelIrSchema.parse({
    widthMm: 40,
    heightMm: 16,
    dpi: 203,
    elements: [
      { id: 'band', type: 'rect', xMm: 0, yMm: 0, widthMm: 40, heightMm: 16, strokeWidthDots: 1, filled: true },
      element,
    ],
  })

function pixels(ir: LabelIR): { dark: number; light: number } {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))
  const image = new Resvg(irToSvg(ir), {
    font: {
      fontFiles: fonts.fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: fonts.defaultFontFamily,
    },
  }).render()
  const raw = image.pixels
  let dark = 0
  let light = 0
  for (let index = 0; index < image.width * image.height; index += 1) {
    const red = raw[index * 4] ?? 255
    if (red < 128) {
      dark += 1
    } else {
      light += 1
    }
  }
  return { dark, light }
}

const text = (inverted: boolean): Record<string, unknown> => ({
  id: 't',
  type: 'text',
  xMm: 2,
  yMm: 3,
  widthMm: 36,
  heightMm: 8,
  content: '出货',
  fontFamily: 'Noto Sans CJK SC',
  fontSizeMm: 6,
  inverted,
})

describe('inverted elements', () => {
  it('knocks white glyphs out of a black band', () => {
    const normal = pixels(onBlackBand(text(false)))
    const white = pixels(onBlackBand(text(true)))

    // Black text on a black band is invisible: the band is all there is.
    expect(normal.light).toBe(0)
    // Inverted, the glyphs are the only light pixels on the label.
    expect(white.light).toBeGreaterThan(0)
  })

  it('draws normally when the flag is off, so nothing changes by default', () => {
    const plain = labelIrSchema.parse({
      widthMm: 40,
      heightMm: 16,
      dpi: 203,
      elements: [text(false)],
    })
    expect(pixels(plain).dark).toBeGreaterThan(0)
  })

  it('leaves an inverted element on bare paper invisible rather than guessing', () => {
    // No compositing and no automatic backing box: white on white is nothing.
    // Documented by a test because the alternative — quietly drawing a black
    // box behind it — is a thing somebody will otherwise assume happens.
    const bare = labelIrSchema.parse({
      widthMm: 40,
      heightMm: 16,
      dpi: 203,
      elements: [text(true)],
    })
    expect(pixels(bare).dark).toBe(0)
  })

  it('inverts a rule, not only text', () => {
    const rule = (inverted: boolean): LabelIR =>
      onBlackBand({
        id: 'l',
        type: 'line',
        xMm: 2,
        yMm: 8,
        x2Mm: 38,
        y2Mm: 8,
        strokeWidthDots: 4,
        inverted,
      })
    expect(pixels(rule(false)).light).toBe(0)
    expect(pixels(rule(true)).light).toBeGreaterThan(0)
  })

  it('inverts an outlined shape', () => {
    const box = (inverted: boolean): LabelIR =>
      onBlackBand({
        id: 'r',
        type: 'rect',
        xMm: 4,
        yMm: 4,
        widthMm: 20,
        heightMm: 8,
        strokeWidthDots: 3,
        filled: false,
        inverted,
      })
    expect(pixels(box(false)).light).toBe(0)
    expect(pixels(box(true)).light).toBeGreaterThan(0)
  })

  it('defaults to off when the field is absent, so old designs are unchanged', () => {
    const parsed = labelIrSchema.parse({
      widthMm: 40,
      heightMm: 16,
      dpi: 203,
      elements: [
        { id: 't', type: 'text', xMm: 2, yMm: 3, widthMm: 36, heightMm: 8, content: 'x', fontFamily: 'F', fontSizeMm: 4 },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({ inverted: false })
  })
})
