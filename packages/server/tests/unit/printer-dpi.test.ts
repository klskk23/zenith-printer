import { describe, expect, it } from 'vitest'
import { atPrinterDpi, maxLabelWidthMm } from '../../src/domain/printer.ts'
import type { ProbedCapabilities } from '../../src/domain/printer.ts'
import { checkLabel } from '../../src/domain/overflow.ts'
import { labelIrSchema, type LabelIR } from '@zenith/shared'

/**
 * A design carries millimetres; the printer carries the dot grid.
 *
 * Keeping the design's own dpi meant a template was tied to the machine it was
 * drawn against: move it to a printer of a different resolution and it printed
 * at the wrong physical size until somebody opened and re-saved it.
 */
const capabilities = (dpi: number, printheadPixels = 576): ProbedCapabilities => ({
  dpi,
  printheadPixels,
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: [1],
  printDirection: 'top',
  supportsConsumableLevel: true,
  model: 'test',
  serial: null,
  firmwareVersion: null,
})

describe('rendering at the printer resolution', () => {
  it('takes the dpi from the printer, not from the design', () => {
    expect(atPrinterDpi({ widthMm: 50, dpi: 203 }, capabilities(300)).dpi).toBe(300)
  })

  it('leaves the millimetres alone, because they are the design', () => {
    const ir = { widthMm: 50, heightMm: 30, dpi: 203, elements: [] }
    const at300 = atPrinterDpi(ir, capabilities(300))
    expect(at300.widthMm).toBe(50)
    expect(at300.heightMm).toBe(30)
    expect(at300.elements).toBe(ir.elements)
  })

  it('returns the same object when the design already matches', () => {
    // Identity, so the common case adds no copy and nothing downstream sees a
    // new reference where none was needed.
    const ir = { widthMm: 50, dpi: 203 }
    expect(atPrinterDpi(ir, capabilities(203))).toBe(ir)
  })

  it('does not change how wide a label may be, which is a millimetre question', () => {
    // 576 dots at 203 dpi is ~72mm; the same head reported at 300 dpi would be
    // a different head. This is here to pin that the two are independent.
    expect(maxLabelWidthMm(capabilities(203))).toBeCloseTo(72.07, 2)
  })
})

describe('what moves with the resolution and what does not', () => {
  // Parsed rather than hand-built: the schema fills the defaults, so the test
  // uses the same element shape the server does.
  const label = (widthMm: number, moduleWidthDots: number): LabelIR =>
    labelIrSchema.parse({
      widthMm,
      heightMm: 30,
      dpi: 203,
      elements: [
        {
          id: 'code',
          type: 'barcode',
          xMm: 2,
          yMm: 2,
          widthMm: 40,
          heightMm: 12,
          rotation: 0,
          content: 'ABC-12345',
          symbology: 'code128',
          moduleWidthDots,
        },
      ],
    })
  const ir = label(50, 2)

  it('narrows a barcode on a finer head rather than putting modules on part-dots', () => {
    // The module width is a dot count, so it stays whole and the bars stay
    // crisp. Holding the millimetres instead would land modules on fractional
    // dots, and a barcode a scanner refuses is worse than a smaller one.
    const at203 = checkLabel(ir, {}, 0)
    const at300 = checkLabel(atPrinterDpi(ir, capabilities(300, 852)), {}, 0)

    // Fits at both: shrinking cannot overflow.
    expect(at203).toEqual([])
    expect(at300).toEqual([])
  })

  it('still catches a barcode too wide for the label, at the printer resolution', () => {
    // The check that matters is run against the head it is going to, not the
    // one the design happened to be drawn on.
    const wide = label(12, 6)
    expect(checkLabel(atPrinterDpi(wide, capabilities(203)), {}, 0)[0]?.reason).toBe(
      'BARCODE_TOO_WIDE',
    )
  })
})
