import { describe, expect, it } from 'vitest'
import {
  BarcodeContentError,
  DEFAULT_MODULE_WIDTH_DOTS,
  barcodeInnerMarkup,
  renderBarcodeSvg,
  renderQrcodeSvg,
  QrcodeContentError,
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

describe('module width defaults', () => {
  it('defaults to two dots, i.e. 0.25mm at 203 dpi', () => {
    expect(DEFAULT_MODULE_WIDTH_DOTS).toBe(2)
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

/**
 * QR codes.
 *
 * Before this feature a `qrcode` element was rendered by asking for a Code 128
 * barcode of the same content — the symbology was hardcoded. The output was a
 * plausible-looking barcode, so nothing failed loudly; it simply could not be
 * scanned as a QR code and was far wider than the element that declared it.
 */
describe('renderQrcodeSvg', () => {
  it('produces a square matrix, not a linear barcode', () => {
    const rendered = renderQrcodeSvg({ content: 'https://example.com', moduleWidthDots: 2 })
    expect(rendered.widthDots).toBe(rendered.heightDots)
  })

  it('scales linearly with the module width', () => {
    const one = renderQrcodeSvg({ content: 'https://example.com', moduleWidthDots: 2 })
    const two = renderQrcodeSvg({ content: 'https://example.com', moduleWidthDots: 4 })
    expect(two.widthDots).toBe(one.widthDots * 2)
  })

  it('reports a module count independent of the module width', () => {
    const a = renderQrcodeSvg({ content: 'ABC-12345', moduleWidthDots: 2 })
    const b = renderQrcodeSvg({ content: 'ABC-12345', moduleWidthDots: 5 })
    expect(a.moduleCount).toBe(b.moduleCount)
  })

  it('grows the matrix at the highest error-correction level', () => {
    const m = renderQrcodeSvg({ content: 'https://example.com', errorCorrectionLevel: 'M', moduleWidthDots: 2 })
    const h = renderQrcodeSvg({ content: 'https://example.com', errorCorrectionLevel: 'H', moduleWidthDots: 2 })
    expect(h.moduleCount).toBeGreaterThan(m.moduleCount)
  })

  it('places every module edge on a whole dot', () => {
    const rendered = renderQrcodeSvg({ content: 'ABC-12345', moduleWidthDots: 3 })
    const coords = [...rendered.svg.matchAll(/[ML]([0-9.]+)[ ,]([0-9.]+)/g)]
      .flatMap((m) => [Number(m[1]), Number(m[2])])
    expect(coords.length).toBeGreaterThan(0)
    expect(coords.filter((n) => !Number.isInteger(n))).toEqual([])
  })

  it('rejects content that will not fit the chosen error-correction level', () => {
    // 'H' spends the most of the symbol on recovery data, so it runs out first.
    const tooLong = 'A'.repeat(4000)
    expect(() => renderQrcodeSvg({ content: tooLong, errorCorrectionLevel: 'H', moduleWidthDots: 2 }))
      .toThrow(QrcodeContentError)
  })

  it('refuses empty content rather than emitting an unreadable symbol', () => {
    expect(() => renderQrcodeSvg({ content: '', moduleWidthDots: 2 })).toThrow(QrcodeContentError)
  })
})

/**
 * Module width.
 *
 * An earlier version of this module required an even width, on the reasoning
 * that odd-width bars would land on half-dot boundaries. That was a measurement
 * error: the check paired every path with the *first* path's stroke-width,
 * while bwip-js groups bars into several paths each with its own. Re-measured
 * per path, every edge is integral at every whole scale.
 */
describe('module width', () => {
  it.each([2, 3, 4, 5, 7])('accepts a module width of %i dots', (moduleWidthDots) => {
    expect(() => renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots }))
      .not.toThrow()
  })

  it.each([1, 0, -2, 2.5])('rejects %s', (moduleWidthDots) => {
    expect(() => renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots }))
      .toThrow()
  })

  const CASES = [
    { symbology: 'code128' as const, content: 'ABC-12345' },
    { symbology: 'code128' as const, content: '1' },
    { symbology: 'code128' as const, content: 'AAAAAAAAAAAAAA' },
    { symbology: 'code39' as const, content: 'ABC123' },
    { symbology: 'ean13' as const, content: '4006381333931' },
    { symbology: 'ean8' as const, content: '96385074' },
    { symbology: 'itf14' as const, content: '15400141288763' },
  ]

  it.each(CASES)('keeps every bar edge on a whole dot for $symbology', ({ symbology, content }) => {
    for (const moduleWidthDots of [2, 3, 4, 5, 7]) {
      const rendered = renderBarcodeSvg({ symbology, content, heightDots: 60, moduleWidthDots })

      // Each <path> carries its own stroke-width; pairing a path with any other
      // path's width is what produced the bogus "odd widths misalign" result.
      const paths = [...rendered.svg.matchAll(/<path stroke="[^"]*" stroke-width="([0-9.]+)" d="([^"]*)"/g)]
      expect(paths.length).toBeGreaterThan(0)

      for (const [, widthText, d] of paths) {
        const strokeWidth = Number(widthText)
        for (const [, xText] of (d ?? '').matchAll(/M([0-9.]+) /g)) {
          const centre = Number(xText)
          expect(Number.isInteger(centre - strokeWidth / 2)).toBe(true)
          expect(Number.isInteger(centre + strokeWidth / 2)).toBe(true)
        }
      }
    }
  })

  it('reports the module count so callers can quantise width', () => {
    const rendered = renderBarcodeSvg({ symbology: 'code128', content: 'ABC-12345', heightDots: 60, moduleWidthDots: 2 })
    expect(rendered.moduleCount).toBe(rendered.widthDots / 2)
  })
})
