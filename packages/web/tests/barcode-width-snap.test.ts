import { describe, expect, it } from 'vitest'
import {
  MIN_MODULE_WIDTH_DOTS,
  dotsToMm,
  labelIrSchema,
  type BarcodeElement,
  type QrcodeElement,
} from '@zenith/shared'
import {
  largestModuleWidthWithin,
  moduleCountOf,
  resizePatchFor,
  snapWidth,
  symbolBoxMm,
  widthForModule,
} from '../src/editor/barcode-width.ts'

const DPI = 203
/** 'ABC-12345' in Code 128, measured. */
const MODULES = 123

describe('snapWidth', () => {
  it('lands on a whole multiple of the module count', () => {
    for (const targetMm of [10, 15.4, 23, 30.8, 46.2, 61.5]) {
      const result = snapWidth(targetMm, MODULES, DPI)
      expect(result.widthDots % MODULES).toBe(0)
    }
  })

  it('picks the nearest achievable width', () => {
    // Module 2 is 246 dots (30.8mm); module 3 is 369 (46.2mm). 32mm is nearer 2.
    expect(snapWidth(32, MODULES, DPI).moduleWidthDots).toBe(2)
    expect(snapWidth(45, MODULES, DPI).moduleWidthDots).toBe(3)
  })

  it('never goes below the scanning floor', () => {
    const result = snapWidth(1, MODULES, DPI)
    expect(result.moduleWidthDots).toBe(MIN_MODULE_WIDTH_DOTS)
    expect(result.clampedToFloor).toBe(true)
  })

  it('does not report clamping when the request was already legal', () => {
    expect(snapWidth(31, MODULES, DPI).clampedToFloor).toBe(false)
  })

  it('accepts odd module widths', () => {
    // The even-only rule this project used to enforce was a measurement error;
    // odd widths align on whole dots just as well.
    expect(snapWidth(dotsToMm(3 * MODULES, DPI), MODULES, DPI).moduleWidthDots).toBe(3)
    expect(snapWidth(dotsToMm(5 * MODULES, DPI), MODULES, DPI).moduleWidthDots).toBe(5)
  })

  it('is idempotent — snapping a snapped width changes nothing', () => {
    const once = snapWidth(37, MODULES, DPI)
    expect(snapWidth(once.widthMm, MODULES, DPI)).toEqual(once)
  })

  it('is stable for a different module count', () => {
    // EAN-13 is 96 modules; the steps are different but the rule is the same.
    const result = snapWidth(30, 96, DPI)
    expect(result.widthDots % 96).toBe(0)
  })

  it('survives a zero module count without dividing by it', () => {
    expect(snapWidth(30, 0, DPI).moduleWidthDots).toBe(MIN_MODULE_WIDTH_DOTS)
  })
})

describe('widthForModule', () => {
  it('reports the width each step produces', () => {
    expect(widthForModule(2, MODULES, DPI)).toBeCloseTo(30.8, 1)
    expect(widthForModule(3, MODULES, DPI)).toBeCloseTo(46.2, 1)
  })

  it('scales linearly, which is what makes the steps predictable', () => {
    expect(widthForModule(4, MODULES, DPI)).toBeCloseTo(widthForModule(2, MODULES, DPI) * 2, 6)
  })
})

describe('largestModuleWidthWithin', () => {
  it('rounds down so the symbol stays inside the box', () => {
    // 40mm is 320 dots; 320/123 is 2.6, so 2 — 3 would overflow.
    expect(largestModuleWidthWithin(40, MODULES, DPI)).toBe(2)
  })

  it('never returns something that overflows', () => {
    for (const availableMm of [12, 20, 31, 47, 62, 100]) {
      const module = largestModuleWidthWithin(availableMm, MODULES, DPI)
      // The floor can exceed a very small box; that is a warning, not a silent
      // overflow, and is reported by the overflow check instead.
      if (module > MIN_MODULE_WIDTH_DOTS) {
        expect(widthForModule(module, MODULES, DPI)).toBeLessThanOrEqual(availableMm + 1e-9)
      }
    }
  })

  it('respects the floor even in a box too small for it', () => {
    expect(largestModuleWidthWithin(5, MODULES, DPI)).toBe(MIN_MODULE_WIDTH_DOTS)
  })
})

describe('symbol sizing', () => {
  const DPI = 203

  function qrcode(over: Record<string, unknown> = {}): QrcodeElement {
    return labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: DPI,
      elements: [{
        id: 'q', type: 'qrcode', xMm: 1, yMm: 1, widthMm: 15, heightMm: 15,
        content: 'https://example.com', errorCorrectionLevel: 'M', moduleWidthDots: 2, ...over,
      }],
    }).elements[0]! as QrcodeElement
  }

  function barcode(over: Record<string, unknown> = {}): BarcodeElement {
    return labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: DPI,
      elements: [{
        id: 'b', type: 'barcode', xMm: 1, yMm: 1, widthMm: 30, heightMm: 10,
        content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2, ...over,
      }],
    }).elements[0]! as BarcodeElement
  }

  describe('moduleCountOf', () => {
    it('does not depend on the module width', () => {
      // The count comes from the content and the symbology; the module width
      // only decides how wide each of those modules is drawn.
      expect(moduleCountOf(qrcode({ moduleWidthDots: 2 }))).toBe(
        moduleCountOf(qrcode({ moduleWidthDots: 8 })),
      )
    })

    it('grows with the content', () => {
      const short = moduleCountOf(qrcode({ content: 'a' }))!
      const long = moduleCountOf(qrcode({ content: 'x'.repeat(300) }))!
      expect(long).toBeGreaterThan(short)
    })

    it('counts a QR code that carries newlines', () => {
      // A QR code holds bytes and a newline is a byte — a vCard is several
      // lines by definition. The editor only offered a single-line field.
      expect(moduleCountOf(qrcode({ content: 'line one\nline two' }))).toBeGreaterThan(0)
    })

    it('reports nothing for content the symbology cannot encode', () => {
      expect(moduleCountOf(barcode({ symbology: 'ean13', content: 'not-a-number' }))).toBeNull()
    })
  })

  describe('symbolBoxMm', () => {
    it('is square for a QR code', () => {
      const box = symbolBoxMm(qrcode(), DPI)!
      expect(box.heightMm).toBeCloseTo(box.widthMm, 6)
    })

    it('scales with the module width', () => {
      const small = symbolBoxMm(qrcode({ moduleWidthDots: 2 }), DPI)!.widthMm
      const large = symbolBoxMm(qrcode({ moduleWidthDots: 6 }), DPI)!.widthMm
      expect(large).toBeCloseTo(small * 3, 6)
    })

    it('leaves a barcode’s height to the caller', () => {
      // A barcode's height is a free choice, unlike its width.
      expect(symbolBoxMm(barcode(), DPI)!.heightMm).toBeUndefined()
    })
  })

  describe('resizePatchFor', () => {
    /**
     * The defect behind "the QR still cannot be resized". A drag wrote the
     * box; the renderer sizes the symbol from the module width and takes the
     * smaller of the two, so the frame grew around a symbol that had not
     * moved. Both fields have to travel together.
     */
    it('carries the module width along with the box', () => {
      const patch = resizePatchFor(qrcode(), { widthMm: 25, heightMm: 25 }, DPI) as Record<string, number>
      expect(patch.moduleWidthDots).toBeGreaterThan(2)
      expect(patch.widthMm).toBeGreaterThan(0)
      expect(patch.heightMm).toBeCloseTo(patch.widthMm!, 6)
    })

    it('produces a box the module width actually yields', () => {
      const patch = resizePatchFor(qrcode(), { widthMm: 25, heightMm: 25 }, DPI) as Record<string, number>
      const count = moduleCountOf(qrcode())!
      expect(patch.widthMm).toBeCloseTo(widthForModule(patch.moduleWidthDots!, count, DPI), 6)
    })

    it('keeps the dragged height for a barcode', () => {
      const patch = resizePatchFor(barcode(), { widthMm: 40, heightMm: 17 }, DPI) as Record<string, number>
      expect(patch.heightMm).toBeCloseTo(17, 6)
      expect(patch.moduleWidthDots).toBeGreaterThan(0)
    })

    it('never goes below the scanning floor', () => {
      const patch = resizePatchFor(qrcode(), { widthMm: 0.5, heightMm: 0.5 }, DPI) as Record<string, number>
      expect(patch.moduleWidthDots).toBe(MIN_MODULE_WIDTH_DOTS)
    })

    it('passes an ordinary element’s size straight through', () => {
      const rect = labelIrSchema.parse({
        widthMm: 50, heightMm: 30, dpi: DPI,
        elements: [{ id: 'r', type: 'rect', xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, strokeWidthDots: 1 }],
      }).elements[0]!
      expect(resizePatchFor(rect, { widthMm: 12.34, heightMm: 5.6 }, DPI)).toEqual({
        widthMm: 12.34,
        heightMm: 5.6,
      })
    })

    it('leaves the size alone when the content cannot be encoded', () => {
      const broken = barcode({ symbology: 'ean13', content: 'not-a-number' })
      expect(resizePatchFor(broken, { widthMm: 20, heightMm: 8 }, DPI)).toEqual({
        widthMm: 20,
        heightMm: 8,
      })
    })
  })
})
