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
