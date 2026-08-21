import { describe, expect, it } from 'vitest'
import {
  BarcodeContentError,
  DEFAULT_MODULE_WIDTH_DOTS,
  barcodeInnerMarkup,
  renderBarcodeSvg,
} from '../src/barcode/index.ts'

/** Every coordinate emitted in the path data. */
function pathCoordinates(svg: string): number[] {
  return [...svg.matchAll(/[ML](-?[0-9.]+) (-?[0-9.]+)/g)].flatMap((m) => [
    Number(m[1]),
    Number(m[2]),
  ])
}

function strokeWidths(svg: string): number[] {
  return [...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1]))
}

describe('module width', () => {
  it('defaults to two dots, i.e. 0.25mm at 203 dpi', () => {
    expect(DEFAULT_MODULE_WIDTH_DOTS).toBe(2)
  })

  it('rejects an odd module width', () => {
    // An odd module width gives odd bar widths, whose centre-stroked edges land
    // on half dots. The bars then round inconsistently and the scan rate drops.
    expect(() =>
      renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots: 3 }),
    ).toThrow(/even/i)
  })

  it('rejects a module width below one whole bar', () => {
    expect(() =>
      renderBarcodeSvg({ symbology: 'code128', content: 'ABC', heightDots: 60, moduleWidthDots: 1 }),
    ).toThrow(/at least 2/i)
    expect(() =>
      renderBarcodeSvg({ symbology: 'code128', content: 'ABC', heightDots: 60, moduleWidthDots: 2.5 }),
    ).toThrow()
  })
})

describe('dot alignment', () => {
  it.each([2, 4, 6, 8])('keeps every coordinate whole at module width %i', (moduleWidthDots) => {
    const rendered = renderBarcodeSvg({
      symbology: 'code128',
      content: 'ABC-12345',
      heightDots: 60,
      moduleWidthDots,
    })
    const coords = pathCoordinates(rendered.svg)
    expect(coords.length).toBeGreaterThan(0)
    expect(coords.every(Number.isInteger)).toBe(true)
  })

  it.each([2, 4, 6, 8])('keeps every bar edge whole at module width %i', (moduleWidthDots) => {
    const rendered = renderBarcodeSvg({
      symbology: 'code128',
      content: 'ABC-12345',
      heightDots: 60,
      moduleWidthDots,
    })
    // Bars are centre-stroked, so an edge sits at centre +/- half the width.
    // Every stroke width must therefore be even.
    expect(strokeWidths(rendered.svg).every((w) => w % 2 === 0)).toBe(true)
  })

  it('scales bar widths in whole multiples of the module', () => {
    const narrow = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots: 2 })
    const wide = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots: 4 })
    expect(wide.widthDots).toBe(narrow.widthDots * 2)
  })

  it('reports a width that is a whole number of dots', () => {
    const rendered = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60 })
    expect(Number.isInteger(rendered.widthDots)).toBe(true)
    expect(Number.isInteger(rendered.heightDots)).toBe(true)
  })
})

describe('content validation', () => {
  it('rejects empty content', () => {
    expect(() => renderBarcodeSvg({ symbology: 'code128', content: '', heightDots: 60 })).toThrow(
      BarcodeContentError,
    )
  })

  it('rejects content the symbology cannot encode', () => {
    // EAN-13 takes 12 or 13 digits and nothing else.
    expect(() => renderBarcodeSvg({ symbology: 'ean13', content: 'NOT-DIGITS', heightDots: 60 })).toThrow(
      BarcodeContentError,
    )
  })

  it('names the offending symbology and content on failure', () => {
    try {
      renderBarcodeSvg({ symbology: 'ean13', content: '123', heightDots: 60 })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BarcodeContentError)
      expect((err as BarcodeContentError).symbology).toBe('ean13')
      expect((err as BarcodeContentError).content).toBe('123')
    }
  })

  it('accepts a valid EAN-13 payload', () => {
    expect(() => renderBarcodeSvg({ symbology: 'ean13', content: '4006381333931', heightDots: 60 })).not.toThrow()
  })
})

describe('barcodeInnerMarkup', () => {
  it('removes the outer svg wrapper so the markup can be nested', () => {
    const rendered = renderBarcodeSvg({ symbology: 'code128', content: 'ABC', heightDots: 60 })
    const inner = barcodeInnerMarkup(rendered)
    expect(inner).not.toMatch(/<svg/)
    expect(inner).not.toMatch(/<\/svg>/)
    expect(inner).toMatch(/<path/)
  })

  it('is deterministic for identical input', () => {
    const a = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60 })
    const b = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60 })
    expect(barcodeInnerMarkup(a)).toBe(barcodeInnerMarkup(b))
  })
})
