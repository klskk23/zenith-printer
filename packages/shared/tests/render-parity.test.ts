/**
 * Properties of the SVG that make editor/printer parity possible.
 *
 * The guarantee itself is structural: both sides call `irToSvg` from this
 * package, so "IR -> SVG" cannot diverge. What this file pins is that the
 * markup contains nothing whose *meaning* differs between renderers — because
 * identical markup interpreted differently is divergence by another route.
 *
 * The other half of the check, that the markup rasterises to stable bytes,
 * lives in the server package where the rasteriser is a declared dependency.
 * This package deliberately has none.
 */
import { describe, expect, it } from 'vitest'
import { irToSvg } from '../src/ir-to-svg/index.ts'
import { labelIrSchema, type LabelIR } from '../src/ir/schema.ts'

/** Everything this feature added, on one label. */
export const RICH: LabelIR = labelIrSchema.parse({
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 'title', type: 'text', xMm: 2, yMm: 1, widthMm: 46, heightMm: 12, content: '\u7b2c\u4e00\u884c First\n\u7b2c\u4e8c\u884c Second', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3, bold: true },
    { id: 'code', type: 'barcode', xMm: 2, yMm: 13, widthMm: 30, heightMm: 8, content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2 },
    { id: 'qr', type: 'qrcode', xMm: 34, yMm: 13, widthMm: 14, heightMm: 14, content: 'https://example.com', moduleWidthDots: 2 },
    { id: 'oval', type: 'ellipse', xMm: 2, yMm: 22, widthMm: 20, heightMm: 6, strokeWidthDots: 2, filled: false },
  ],
})

describe('the SVG carries nothing renderer-dependent', () => {
  const svg = irToSvg(RICH)

  it('positions text lines absolutely', () => {
    // `dy` renders identically in resvg — measured — but it makes each line's
    // position depend on the renderer accumulating the one before it.
    expect(svg).not.toContain('dy=')
  })

  it('uses no font-relative or physical units', () => {
    // em, ex, pt or mm in the output would each be resolved by the renderer's
    // own rules rather than by the dot grid this package establishes.
    expect(svg).not.toMatch(/"\s*[0-9.]+(em|ex|pt|pc|mm|cm|in)\s*"/)
  })

  it('states an explicit font family rather than relying on a default', () => {
    expect(svg).toContain('font-family=')
  })

  it('maps user units one-to-one onto dots', () => {
    expect(svg).toContain('viewBox="0 0 400 240"')
  })

  it('leaves no unresolved variable placeholders', () => {
    expect(svg).not.toContain('$var')
  })

  it('does not wrap: a long single line stays one line', () => {
    const long = labelIrSchema.parse({
      ...RICH,
      elements: [{ ...RICH.elements[0], content: 'A'.repeat(500) }],
    })
    expect([...irToSvg(long).matchAll(/<tspan/g)]).toHaveLength(1)
  })
})
