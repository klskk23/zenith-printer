/**
 * Sizing a barcode or QR code by what it will actually encode.
 *
 * A symbol's size is `moduleWidth x moduleCount` and the module count comes
 * from the content — so a symbol bound to `${订单号}` is only the right size on
 * screen if it is measured against the value that column will supply. Measured
 * against the literal `${订单号}`, or against a stand-in, the frame on the
 * canvas describes a symbol nobody is going to print.
 *
 * Text has been measured this way since the boxes were made to follow content;
 * these two were not, because the value never reached them.
 */
import { describe, expect, it } from 'vitest'
import {
  labelIrSchema,
  type BarcodeElement,
  type QrcodeElement,
  type TextElement,
} from '@zenith/shared'
import { symbolBoxMm, symbolFitMm, moduleCountOf } from '../src/editor/barcode-width.ts'
import { refit, refitReferences } from '../src/editor/autofit.ts'

const DPI = 203

const barcode = (content: string): BarcodeElement =>
  labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: DPI,
    elements: [
      {
        id: 'c',
        type: 'barcode',
        xMm: 0,
        yMm: 0,
        widthMm: 30,
        heightMm: 10,
        content,
        symbology: 'code128',
        moduleWidthDots: 2,
      },
    ],
  }).elements[0] as BarcodeElement

const qrcode = (content: string): QrcodeElement =>
  labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: DPI,
    elements: [
      {
        id: 'q',
        type: 'qrcode',
        xMm: 0,
        yMm: 0,
        widthMm: 15,
        heightMm: 15,
        content,
        moduleWidthDots: 2,
      },
    ],
  }).elements[0] as QrcodeElement

describe('measuring a symbol by its resolved content', () => {
  it('counts modules for the value, not for the reference text', () => {
    const short = moduleCountOf(barcode('${sku}'), { sku: 'A1' })
    const long = moduleCountOf(barcode('${sku}'), { sku: 'A1234567890123456789' })
    expect(short).not.toBeNull()
    expect(long).toBeGreaterThan(short!)
  })

  it('sizes the box from the value a column will supply', () => {
    const short = symbolBoxMm(barcode('${sku}'), DPI, { sku: 'A1' })
    const long = symbolBoxMm(barcode('${sku}'), DPI, { sku: 'A1234567890123456789' })
    expect(long!.widthMm).toBeGreaterThan(short!.widthMm)
  })

  it('does the same for a QR code, whose side follows its content', () => {
    const short = symbolBoxMm(qrcode('${url}'), DPI, { url: 'a' })
    const long = symbolBoxMm(qrcode('${url}'), DPI, { url: 'https://example.com/orders/1234567890' })
    expect(long!.widthMm).toBeGreaterThan(short!.widthMm)
    // Square by definition, and it has to stay square as it grows.
    expect(long!.heightMm).toBe(long!.widthMm)
  })

  it('snaps a dragged width against the real module count', () => {
    // The achievable widths are multiples of the module count, so dragging to
    // 20 mm lands somewhere different for a short value than for a long one.
    const short = symbolFitMm(barcode('${sku}'), 20, DPI, { sku: 'A1' })
    const long = symbolFitMm(barcode('${sku}'), 20, DPI, { sku: 'A1234567890123456789' })
    expect(short!.moduleWidthDots).toBeGreaterThan(long!.moduleWidthDots)
  })

  it('refits a symbol using the values it is given, as it already does for text', () => {
    const element = barcode('${sku}')
    const short = refit(null, element, DPI, { sku: 'A1' })
    const long = refit(null, element, DPI, { sku: 'A1234567890123456789' })
    expect((long as BarcodeElement).widthMm).toBeGreaterThan((short as BarcodeElement).widthMm)
  })

  it('falls back to a stand-in while the reference has no value yet', () => {
    // An unwritten variable should leave a box of roughly the right size
    // rather than collapsing it, which is what an empty string would do.
    expect(symbolBoxMm(barcode('${sku}'), DPI, {})!.widthMm).toBeGreaterThan(0)
  })

  it('still measures literal content, which needs no values at all', () => {
    const short = symbolBoxMm(barcode('AB'), DPI, {})
    const long = symbolBoxMm(barcode('ABCDEFGHIJKLMNOP'), DPI, {})
    expect(long!.widthMm).toBeGreaterThan(short!.widthMm)
  })
})

describe('refitting when the values change', () => {
  const design = (...elements: unknown[]) =>
    labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: DPI, elements })

  const code = {
    id: 'c',
    type: 'barcode',
    xMm: 0,
    yMm: 0,
    widthMm: 30,
    heightMm: 10,
    content: '${sku}',
    symbology: 'code128',
    moduleWidthDots: 2,
  }

  it('resizes a bound symbol when the value behind it changes', () => {
    // The other way content changes: not by editing the element, but by
    // editing the constant — or the row — it points at.
    const short = refitReferences(design(code), { sku: 'A1' })
    const long = refitReferences(design(code), { sku: 'A1234567890123456789' })
    expect((long.elements[0] as BarcodeElement).widthMm).toBeGreaterThan(
      (short.elements[0] as BarcodeElement).widthMm,
    )
  })

  it('leaves a literal element alone, width and all', () => {
    // Refitting it would discard a width somebody set by hand, for a reason
    // that has nothing to do with that element.
    const literal = { ...code, id: 'lit', content: 'ABC-12345', widthMm: 44 }
    const before = design(literal)
    const after = refitReferences(before, { sku: 'anything' })
    expect(after.elements[0]).toBe(before.elements[0])
  })

  it('returns the very same design when nothing moved', () => {
    // Identity, not equality: the editor uses it to decide whether to record
    // an undo step, and a fresh object every render would loop.
    const ir = refitReferences(design(code), { sku: 'A1' })
    expect(refitReferences(ir, { sku: 'A1' })).toBe(ir)
  })

  it('resizes bound text too, which is the rule this one was missing', () => {
    const bound = {
      id: 't',
      type: 'text',
      xMm: 0,
      yMm: 0,
      widthMm: 30,
      heightMm: 5,
      content: '${name}',
      fontFamily: 'F',
      fontSizeMm: 3,
    }
    const short = refitReferences(design(bound), { name: 'A' })
    const long = refitReferences(design(bound), { name: 'AAAAAAAAAAAAAAAAAAAA' })
    expect((long.elements[0] as TextElement).widthMm).toBeGreaterThan(
      (short.elements[0] as TextElement).widthMm,
    )
  })
})
