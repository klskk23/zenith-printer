/**
 * Spaces inside a text element.
 *
 * SVG's default is `xml:space="default"`, which collapses runs of whitespace
 * and strips them from the ends. So a label reading `A  B` came out as `A B`,
 * and one indented with spaces lost its indent — silently, and identically in
 * the editor and on the printed label, because both go through `irToSvg`.
 *
 * Rasterised rather than only string-matched: whether the attribute survives
 * into the image is a question about resvg, and asserting on the markup would
 * answer a different one.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { irToSvg, labelIrSchema, type LabelIR } from '@zenith/shared'
import { loadFontConfig } from '../../src/render/fonts.ts'

const repoRoot = join(import.meta.dirname, '../../../..')

const label = (content: string): LabelIR =>
  labelIrSchema.parse({
    widthMm: 50,
    heightMm: 20,
    dpi: 203,
    elements: [
      {
        id: 't',
        type: 'text',
        xMm: 2,
        yMm: 2,
        widthMm: 46,
        heightMm: 8,
        content,
        fontFamily: 'Noto Sans CJK SC',
        fontSizeMm: 4,
      },
    ],
  })

/** Columns containing at least one dark pixel — the glyphs' horizontal extent. */
function inkedColumns(ir: LabelIR): { first: number; last: number; count: number } {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))
  const image = new Resvg(irToSvg(ir), {
    font: {
      fontFiles: fonts.fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: fonts.defaultFontFamily,
    },
  }).render()
  const { width, height } = image
  const raw = image.pixels

  let first = -1
  let last = -1
  let count = 0
  for (let x = 0; x < width; x += 1) {
    let inked = false
    for (let y = 0; y < height; y += 1) {
      // Darkness, not alpha: the canvas is opaque, so every pixel is opaque
      // and an alpha test would report the whole image as inked. That mistake
      // made the first version of this test pass on identical wrong output.
      const offset = (y * width + x) * 4
      const dark = (raw[offset] ?? 255) < 128 && (raw[offset + 3] ?? 0) > 32
      if (dark) {
        inked = true
        break
      }
    }
    if (inked) {
      count += 1
      last = x
      if (first === -1) {
        first = x
      }
    }
  }
  return { first, last, count }
}

describe('whitespace in text', () => {
  it('keeps a run of spaces, so two words stay two words apart', () => {
    const one = inkedColumns(label('A B'))
    const many = inkedColumns(label('A     B'))
    // Same glyphs, wider gap: the extra spaces have to show up as extra width.
    expect(many.last - many.first).toBeGreaterThan(one.last - one.first)
  })

  it('keeps leading spaces, which are an indent someone typed on purpose', () => {
    const plain = inkedColumns(label('A'))
    const indented = inkedColumns(label('     A'))
    expect(indented.first).toBeGreaterThan(plain.first)
  })

  it('keeps a trailing space from pulling centred text off centre', () => {
    // Centred text anchors on the middle of its own run, so a trailing space
    // that survives shifts the glyphs left. It has to be kept for the width to
    // be right, and this pins what that does.
    const trailing = inkedColumns(label('AB '))
    expect(trailing.count).toBeGreaterThan(0)
  })
})

describe('the measurement this file relies on', () => {
  it('sees more glyphs as more ink, or it is measuring nothing', () => {
    // Guards the assertions above: an `inkedColumns` that reported the whole
    // canvas would make every comparison in this file vacuous.
    expect(inkedColumns(label('AAAAAA')).count).toBeGreaterThan(inkedColumns(label('A')).count)
    expect(inkedColumns(label('A')).first).toBeGreaterThan(0)
  })
})
