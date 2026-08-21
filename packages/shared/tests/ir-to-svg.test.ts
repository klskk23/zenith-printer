import { describe, expect, it } from 'vitest'
import { UnresolvedVariableError, irToSvg } from '../src/ir-to-svg/index.ts'
import { labelIrSchema, type LabelIR } from '../src/ir/schema.ts'

function ir(elements: unknown[], overrides: Partial<LabelIR> = {}): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements,
    ...overrides,
  })
}

const horizontalRule = {
  id: 'rule',
  type: 'line',
  xMm: 2,
  yMm: 10,
  x2Mm: 48,
  y2Mm: 10,
  strokeWidthDots: 1,
}

describe('coordinate system', () => {
  it('expresses the viewBox in dots, not millimetres', () => {
    // One SVG user unit must be one printer dot, otherwise axis-aligned rules
    // cannot be placed on exact pixel rows.
    const svg = irToSvg(ir([horizontalRule]))
    expect(svg).toContain('viewBox="0 0 400 240"')
    expect(svg).toContain('width="400"')
    expect(svg).toContain('height="240"')
  })

  it('scales the viewBox with dpi', () => {
    const svg = irToSvg(ir([horizontalRule], { dpi: 300 }))
    expect(svg).toContain('viewBox="0 0 591 354"')
  })

  it('paints an explicit white ground', () => {
    // Thresholding treats "not written" and "white" differently if the ground
    // is transparent, so it is painted rather than assumed.
    expect(irToSvg(ir([]))).toContain('fill="#ffffff"')
  })
})

describe('determinism', () => {
  it('produces byte-identical output for identical input', () => {
    // SC-010: the same template must render identically after a redeploy.
    const label = ir([
      horizontalRule,
      { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: 'ABC', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3 },
      { id: 'b', type: 'barcode', xMm: 2, yMm: 14, widthMm: 40, heightMm: 10, content: '12345', symbology: 'code128' },
    ])
    expect(irToSvg(label)).toBe(irToSvg(label))
  })

  it('formats numbers through one path, avoiding float drift', () => {
    const svg = irToSvg(ir([{ ...horizontalRule, xMm: 1 / 3 }]))
    expect(svg).not.toMatch(/\d\.\d{6,}/)
  })

  it('emits no negative zero', () => {
    const svg = irToSvg(ir([{ ...horizontalRule, xMm: 0, yMm: 0, x2Mm: 0, y2Mm: 10 }]))
    expect(svg).not.toContain('-0')
  })
})

describe('axis-aligned rules', () => {
  it('offsets an odd-width horizontal rule by half a dot so its edges stay whole', () => {
    // A 1-dot rule is centre-stroked. Centred on a whole dot it covers half of
    // two rows; anti-aliasing greys both and thresholding can erase both.
    const svg = irToSvg(ir([horizontalRule]))
    const line = /<line [^>]*\/>/.exec(svg)?.[0] ?? ''
    expect(line).toContain('y1="0.5"')
    expect(line).toContain('y2="0.5"')
  })

  it('leaves an even-width rule centred on the whole dot', () => {
    const svg = irToSvg(ir([{ ...horizontalRule, strokeWidthDots: 2 }]))
    const line = /<line [^>]*\/>/.exec(svg)?.[0] ?? ''
    expect(line).toContain('y1="0"')
    expect(line).toContain('y2="0"')
  })

  it('offsets an odd-width vertical rule on the x axis instead', () => {
    const svg = irToSvg(ir([{ ...horizontalRule, x2Mm: 2, y2Mm: 20 }]))
    const line = /<line [^>]*\/>/.exec(svg)?.[0] ?? ''
    expect(line).toContain('x1="0.5"')
  })

  it('uses butt caps so a rule does not overhang its declared length', () => {
    expect(irToSvg(ir([horizontalRule]))).toContain('stroke-linecap="butt"')
  })
})

describe('rectangles', () => {
  it('insets an outlined rectangle by half its stroke so the outer edge matches the box', () => {
    const svg = irToSvg(
      ir([{ id: 'r', type: 'rect', xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }]),
    )
    expect(svg).toContain('x="1" y="1"')
  })

  it('renders a filled rectangle without a stroke', () => {
    const svg = irToSvg(
      ir([{ id: 'r', type: 'rect', xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, strokeWidthDots: 1, filled: true }]),
    )
    expect(svg).toContain('fill="#000000"')
    expect(svg).not.toMatch(/<rect[^>]*stroke="#000000"/)
  })
})

describe('images', () => {
  const image = { id: 'logo', type: 'image', xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, assetId: 'a1' }

  it('embeds a resolved asset', () => {
    const svg = irToSvg(ir([image]), { resolveImage: () => 'data:image/png;base64,AAA' })
    expect(svg).toContain('href="data:image/png;base64,AAA"')
  })

  it('skips an unresolved asset rather than failing the whole render', () => {
    const svg = irToSvg(ir([image]), { resolveImage: () => undefined })
    expect(svg).not.toContain('<image')
    expect(svg).toContain('<svg')
  })
})

describe('unresolved variables', () => {
  it('refuses to render an element that still holds a reference', () => {
    // resolveVariables must run first; rendering a raw reference would silently
    // print the literal placeholder onto physical stock.
    const label = ir([
      { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: { $var: 'partNo' }, fontFamily: 'F', fontSizeMm: 3 },
    ])
    expect(() => irToSvg(label)).toThrow(UnresolvedVariableError)
  })

  it('names the offending field', () => {
    const label = ir([
      { id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 10, content: { $var: 'serial' }, symbology: 'code128' },
    ])
    try {
      irToSvg(label)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as UnresolvedVariableError).fieldName).toBe('serial')
    }
  })
})

describe('text', () => {
  it('escapes markup in content', () => {
    const svg = irToSvg(
      ir([{ id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: '<&">', fontFamily: 'F', fontSizeMm: 3 }]),
    )
    expect(svg).toContain('&lt;&amp;&quot;&gt;')
    expect(svg).not.toContain('<&">')
  })

  it('converts font size from millimetres to dots', () => {
    const svg = irToSvg(
      ir([{ id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: 'A', fontFamily: 'F', fontSizeMm: 3 }]),
    )
    // 3mm at 203dpi is 24 dots.
    expect(svg).toContain('font-size="24"')
  })
})

/**
 * The three defects this feature exists to fix, pinned as regressions.
 */
describe('qrcode elements', () => {
  const qr = (over: Record<string, unknown> = {}): LabelIR =>
    labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{
        id: 'q', type: 'qrcode', xMm: 2, yMm: 2, widthMm: 15, heightMm: 15,
        content: 'https://example.com', ...over,
      }],
    })

  it('renders a QR matrix, not a linear barcode', () => {
    const svg = irToSvg(qr())
    // A linear symbology emits several stroked <path> runs; a QR matrix does not.
    expect(svg).not.toMatch(/<path stroke="[^"]*" stroke-width=/)
    expect(svg).toMatch(/<path/)
  })

  it('stays inside the box the element declares', () => {
    // 15 mm at 203 dpi is 120 dots.
    const svg = irToSvg(qr({ widthMm: 15, heightMm: 15 }))
    const xs = [...svg.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])])
    expect(Math.max(...xs)).toBeLessThanOrEqual(120)
  })

  it('honours the error-correction level', () => {
    // 'H' needs a bigger matrix, so at a fixed module width it draws wider.
    const extent = (svg: string): number =>
      Math.max(...[...svg.matchAll(/M([0-9.]+) /g)].map((m) => Number(m[1])))
    const m = extent(irToSvg(qr({ errorCorrectionLevel: 'M', widthMm: 40, heightMm: 40, moduleWidthDots: 2 })))
    const h = extent(irToSvg(qr({ errorCorrectionLevel: 'H', widthMm: 40, heightMm: 40, moduleWidthDots: 2 })))
    expect(h).toBeGreaterThan(m)
  })
})

describe('per-element barcode module width', () => {
  const twoBarcodes = (aWidth: number, bWidth: number): LabelIR =>
    labelIrSchema.parse({
      widthMm: 100, heightMm: 40, dpi: 203,
      elements: [
        { id: 'a', type: 'barcode', xMm: 1, yMm: 1, widthMm: 40, heightMm: 10, content: 'ABC-12345', symbology: 'code128', moduleWidthDots: aWidth },
        { id: 'b', type: 'barcode', xMm: 1, yMm: 20, widthMm: 40, heightMm: 10, content: 'ABC-12345', symbology: 'code128', moduleWidthDots: bWidth },
      ],
    })

  it('lets two barcodes on one label differ', () => {
    const svg = irToSvg(twoBarcodes(2, 4))
    const widths = new Set([...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => m[1]))
    // A single shared module width would collapse these into one set of values.
    expect(widths.size).toBeGreaterThan(2)
  })

  it('makes the rendered width a whole multiple of the module count', () => {
    const extent = (moduleWidthDots: number): number => {
      const svg = irToSvg(labelIrSchema.parse({
        widthMm: 100, heightMm: 40, dpi: 203,
        elements: [{ id: 'a', type: 'barcode', xMm: 0, yMm: 0, widthMm: 40, heightMm: 10, content: 'ABC-12345', symbology: 'code128', moduleWidthDots }],
      }))
      return Math.max(...[...svg.matchAll(/M([0-9.]+) /g)].map((m) => Number(m[1])))
    }
    // Doubling the module width doubles the drawn extent.
    expect(extent(4)).toBeCloseTo(extent(2) * 2, 0)
  })
})

describe('ellipse elements', () => {
  const ellipse = (over: Record<string, unknown> = {}): LabelIR =>
    labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{
        id: 'e', type: 'ellipse', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10,
        strokeWidthDots: 2, filled: false, ...over,
      }],
    })

  it('insets the stroke so the outer edge meets the declared box', () => {
    const svg = irToSvg(ellipse({ widthMm: 20, heightMm: 10, strokeWidthDots: 2 }))
    // 20mm -> 160 dots, rx = 80 - 1 = 79; 10mm -> 80 dots, ry = 40 - 1 = 39.
    expect(svg).toContain('rx="79"')
    expect(svg).toContain('ry="39"')
  })

  it('draws a filled ellipse when asked', () => {
    expect(irToSvg(ellipse({ filled: true }))).toMatch(/<ellipse[^>]*fill="#000000"/)
  })

  it('degrades to a solid shape when the stroke is wider than the minor axis', () => {
    // 1mm tall is 8 dots; a 40-dot stroke has no hole left to draw.
    const svg = irToSvg(ellipse({ heightMm: 1, strokeWidthDots: 40 }))
    expect(svg).toMatch(/<ellipse[^>]*fill="#000000"/)
    expect(svg).not.toContain('stroke-width="40"')
  })

  it('renders a circle as an ellipse with equal radii', () => {
    const svg = irToSvg(ellipse({ widthMm: 10, heightMm: 10, filled: true }))
    const rx = /rx="([0-9.]+)"/.exec(svg)?.[1]
    const ry = /ry="([0-9.]+)"/.exec(svg)?.[1]
    expect(rx).toBe(ry)
  })
})

describe('multi-line text', () => {
  const text = (content: string, over: Record<string, unknown> = {}): LabelIR =>
    labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{
        id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 20,
        content, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3, ...over,
      }],
    })

  const spanYs = (svg: string): number[] =>
    [...svg.matchAll(/<tspan[^>]*y="([0-9.]+)"/g)].map((m) => Number(m[1]))

  it('emits one span per explicit line', () => {
    expect(spanYs(irToSvg(text('one\ntwo\nthree')))).toHaveLength(3)
  })

  it('spaces lines at 1.2 times the font size', () => {
    // 3mm at 203 dpi is 24 dots; 1.2x is 28.8, rounded to 29.
    const ys = spanYs(irToSvg(text('one\ntwo\nthree')))
    expect(ys[1]! - ys[0]!).toBe(29)
    expect(ys[2]! - ys[1]!).toBe(29)
  })

  it('positions every line absolutely, never with dy', () => {
    // dy renders identically in resvg, but makes each line depend on the
    // renderer's accumulation of the one before it.
    const svg = irToSvg(text('one\ntwo'))
    expect(svg).not.toContain('dy=')
    expect(svg).toMatch(/<tspan x="[0-9.]+" y="[0-9.]+"/)
  })

  it('applies the alignment anchor to every line', () => {
    const svg = irToSvg(text('one\ntwo', { align: 'center' }))
    const xs = [...svg.matchAll(/<tspan x="([0-9.]+)"/g)].map((m) => m[1])
    expect(new Set(xs).size).toBe(1)
    expect(svg).toContain('text-anchor="middle"')
  })

  /**
   * FR-049 as a negative assertion. Auto-wrapping needs per-glyph advance
   * widths, and the browser's metrics are not resvg's — the same text in the
   * same box would break at different words on the two sides. This test is
   * here because that is an easy thing to add later while believing it is an
   * improvement.
   */
  it('does not wrap long text to the box width', () => {
    const long = 'A'.repeat(500)
    expect(spanYs(irToSvg(text(long)))).toHaveLength(1)
  })

  it('keeps a single line rendering as one span', () => {
    expect(spanYs(irToSvg(text('just one line')))).toHaveLength(1)
  })

  it('preserves empty lines rather than collapsing them', () => {
    expect(spanYs(irToSvg(text('a\n\nb')))).toHaveLength(3)
  })

  it('escapes markup inside every line', () => {
    expect(irToSvg(text('<b>\n&amp'))).not.toContain('<b>')
  })
})
