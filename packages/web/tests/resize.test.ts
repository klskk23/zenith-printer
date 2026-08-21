import { describe, expect, it } from 'vitest'
import { labelIrSchema } from '@zenith/shared'
import { applyResize, resizeModeFor, type Size } from '../src/editor/resize.ts'

function element(over: Record<string, unknown>) {
  return labelIrSchema.parse({
    widthMm: 50, heightMm: 30, dpi: 203,
    elements: [{ xMm: 1, yMm: 1, widthMm: 20, heightMm: 10, ...over }],
  }).elements[0]!
}

describe('resizeModeFor', () => {
  it.each([
    ['image', { id: 'i', type: 'image', assetId: 'a' }, 'uniform'],
    ['qrcode', { id: 'q', type: 'qrcode', content: 'x', moduleWidthDots: 2 }, 'uniform'],
    ['text', { id: 't', type: 'text', content: 'x', fontFamily: 'f', fontSizeMm: 3 }, 'box-only'],
    ['barcode', { id: 'b', type: 'barcode', content: 'x', symbology: 'code128', moduleWidthDots: 2 }, 'height-and-steps'],
    ['rect', { id: 'r', type: 'rect', strokeWidthDots: 1 }, 'free'],
    ['ellipse', { id: 'e', type: 'ellipse', strokeWidthDots: 1 }, 'free'],
  ])('gives %s the %s rule', (_name, spec, expected) => {
    expect(resizeModeFor(element(spec))).toBe(expected)
  })
})

const original: Size = { widthMm: 20, heightMm: 10 }

describe('uniform', () => {
  it('keeps the aspect ratio when width leads', () => {
    const result = applyResize({ mode: 'uniform', original, desired: { widthMm: 40, heightMm: 11 } })
    expect(result.widthMm / result.heightMm).toBeCloseTo(2, 6)
  })

  it('keeps the aspect ratio when height leads', () => {
    const result = applyResize({ mode: 'uniform', original, desired: { widthMm: 21, heightMm: 30 } })
    expect(result.widthMm / result.heightMm).toBeCloseTo(2, 6)
  })

  it('follows whichever axis moved further', () => {
    // A stretched QR does not scan, so the drag can never produce one.
    const wide = applyResize({ mode: 'uniform', original, desired: { widthMm: 60, heightMm: 10.5 } })
    expect(wide.widthMm).toBeCloseTo(60, 6)
  })
})

describe('free', () => {
  it('takes the requested box', () => {
    expect(applyResize({ mode: 'free', original, desired: { widthMm: 33, heightMm: 44 } }))
      .toEqual({ widthMm: 33, heightMm: 44 })
  })

  it('locks the ratio while the modifier is held', () => {
    const result = applyResize({
      mode: 'free', original, desired: { widthMm: 40, heightMm: 11 }, lockAspect: true,
    })
    expect(result.widthMm / result.heightMm).toBeCloseTo(2, 6)
  })

  it('makes a circle from a square-locked ellipse', () => {
    const result = applyResize({
      mode: 'free',
      original: { widthMm: 10, heightMm: 10 },
      desired: { widthMm: 25, heightMm: 11 },
      lockAspect: true,
    })
    expect(result.widthMm).toBeCloseTo(result.heightMm, 6)
  })
})

describe('box-only (text)', () => {
  it('resizes the box without touching anything else', () => {
    // The caller keeps fontSizeMm as it was: stretching glyphs would produce a
    // shape the printer has no face to render.
    expect(applyResize({ mode: 'box-only', original, desired: { widthMm: 35, heightMm: 5 } }))
      .toEqual({ widthMm: 35, heightMm: 5 })
  })
})

describe('height-and-steps (barcode)', () => {
  const snapWidthMm = (target: number): number => Math.round(target / 5) * 5

  it('takes the height freely', () => {
    expect(applyResize({ mode: 'height-and-steps', original, desired: { widthMm: 20, heightMm: 17 }, snapWidthMm }).heightMm)
      .toBe(17)
  })

  it('quantises the width', () => {
    expect(applyResize({ mode: 'height-and-steps', original, desired: { widthMm: 33, heightMm: 10 }, snapWidthMm }).widthMm)
      .toBe(35)
  })

  it('keeps the current width when no quantiser is supplied', () => {
    expect(applyResize({ mode: 'height-and-steps', original, desired: { widthMm: 33, heightMm: 10 } }).widthMm)
      .toBe(20)
  })
})

describe('minimum size', () => {
  it.each(['free', 'uniform', 'box-only'] as const)('stops %s collapsing to nothing', (mode) => {
    const result = applyResize({ mode, original, desired: { widthMm: 0, heightMm: -5 } })
    expect(result.widthMm).toBeGreaterThan(0)
    expect(result.heightMm).toBeGreaterThan(0)
  })

  it('honours a caller-supplied floor', () => {
    const result = applyResize({ mode: 'free', original, desired: { widthMm: 0.1, heightMm: 0.1 }, minMm: 2 })
    expect(result).toEqual({ widthMm: 2, heightMm: 2 })
  })
})
