/**
 * The rasterised half of the parity guarantee.
 *
 * `@zenith/shared` pins the *shape* of the SVG — nothing in it means different
 * things to different renderers. This pins the *result*: the markup rasterises
 * to stable bytes through the same renderer the printer path uses, so a change
 * to any element's output shows up here instead of on a label.
 *
 * A true browser-vs-resvg pixel diff needs a browser, which this suite has not
 * got. That check stays a manual one rather than being pretended at here.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { irToSvg, labelIrSchema, type LabelIR } from '@zenith/shared'
import { loadFontConfig } from '../../src/render/fonts.ts'

const repoRoot = join(import.meta.dirname, '../../../..')

const RICH: LabelIR = labelIrSchema.parse({
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 'title', type: 'text', xMm: 2, yMm: 1, widthMm: 46, heightMm: 12, content: '第一行 First\n第二行 Second', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3, bold: true },
    { id: 'code', type: 'barcode', xMm: 2, yMm: 13, widthMm: 30, heightMm: 8, content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2 },
    { id: 'qr', type: 'qrcode', xMm: 34, yMm: 13, widthMm: 14, heightMm: 14, content: 'https://example.com', moduleWidthDots: 2 },
    { id: 'oval', type: 'ellipse', xMm: 2, yMm: 22, widthMm: 20, heightMm: 6, strokeWidthDots: 2, filled: false },
  ],
})

function renderHash(ir: LabelIR): string {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))
  const png = new Resvg(irToSvg(ir), {
    font: { fontFiles: fonts.fontFiles, loadSystemFonts: false, defaultFontFamily: fonts.defaultFontFamily },
  })
    .render()
    .asPng()
  return createHash('sha256').update(png).digest('hex')
}

describe('rasterised output', () => {
  it('has the bundled fonts, or every comparison below is vacuous', () => {
    // An empty font set renders blank pages that hash consistently and prove
    // nothing at all. That has already cost one round of measurements here.
    expect(loadFontConfig(join(repoRoot, 'fonts')).fontFiles.length).toBeGreaterThan(0)
  })

  it('renders the same bytes on every run', () => {
    expect(renderHash(RICH)).toBe(renderHash(RICH))
  })

  it('actually draws something', () => {
    const blank = labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements: [] })
    expect(renderHash(RICH)).not.toBe(renderHash(blank))
  })

  it('changes when an element moves, so the pin has teeth', () => {
    const moved = labelIrSchema.parse({
      ...RICH,
      elements: RICH.elements.map((e) => (e.id === 'oval' ? { ...e, xMm: 3 } : e)),
    })
    expect(renderHash(moved)).not.toBe(renderHash(RICH))
  })

  it('changes when a text line is added', () => {
    const extra = labelIrSchema.parse({
      ...RICH,
      elements: RICH.elements.map((e) =>
        e.id === 'title' ? { ...e, content: '第一行 First\n第二行 Second\n第三行 Third' } : e,
      ),
    })
    expect(renderHash(extra)).not.toBe(renderHash(RICH))
  })

  it('changes when a barcode module width changes', () => {
    const wider = labelIrSchema.parse({
      ...RICH,
      elements: RICH.elements.map((e) => (e.id === 'code' ? { ...e, moduleWidthDots: 3 } : e)),
    })
    expect(renderHash(wider)).not.toBe(renderHash(RICH))
  })
})
