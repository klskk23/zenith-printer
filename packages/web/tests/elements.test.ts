/**
 * Element factories.
 *
 * Every element someone adds starts here, so a bad default is a defect that
 * reaches the paper. The rule these follow: a freshly dropped element must be
 * printable as-is. Something that silently fails to print is a poor first
 * impression and a hard one to diagnose.
 */
import { describe, expect, it } from 'vitest'
import { labelElementSchema, labelIrSchema } from '@zenith/shared'
import { ELEMENT_TYPES, createBlankLabel, createElement, nextElementId } from '../src/editor/elements.ts'
import { inspect } from '../src/editor/guards.ts'

const canvas = createBlankLabel(203)

describe('createBlankLabel', () => {
  it('produces a valid, empty label', () => {
    expect(() => labelIrSchema.parse(canvas)).not.toThrow()
    expect(canvas.elements).toEqual([])
  })

  it('defaults to the most common stock', () => {
    expect(canvas).toMatchObject({ widthMm: 50, heightMm: 30, dpi: 203 })
  })

  it('takes a size from preferences when given one', () => {
    expect(createBlankLabel(300, { widthMm: 40, heightMm: 20 })).toMatchObject({
      widthMm: 40, heightMm: 20, dpi: 300,
    })
  })
})

describe('createElement', () => {
  const COMPLETE_TYPES = ELEMENT_TYPES.filter((type) => type !== 'image')

  it.each(COMPLETE_TYPES)('produces a schema-valid %s', (type) => {
    expect(() => labelElementSchema.parse(createElement(type, canvas))).not.toThrow()
  })

  /**
   * The one exception, and it is deliberate: an image element is a placeholder
   * until a file is chosen, so it cannot carry an asset id yet. The guards
   * report that in words rather than letting schema validation surface as a
   * raw error at save time.
   */
  it('produces an image placeholder that the guards explain', () => {
    const image = createElement('image', canvas)
    expect(image).toMatchObject({ type: 'image', assetId: '' })

    const ir = { ...canvas, elements: [image] }
    const violation = inspect(ir, { dpi: 203, printheadPixels: 832 })
      .find((v) => v.code === 'IMAGE_NOT_CHOSEN')
    expect(violation).toMatchObject({ blocking: true, elementId: image.id })
  })

  it.each(ELEMENT_TYPES)('places a new %s inside the canvas', (type) => {
    const element = createElement(type, canvas)
    expect(element.xMm).toBeGreaterThanOrEqual(0)
    expect(element.yMm).toBeGreaterThanOrEqual(0)
    if ('widthMm' in element) {
      expect(element.xMm + element.widthMm).toBeLessThanOrEqual(canvas.widthMm)
    }
  })

  it.each(ELEMENT_TYPES)('gives a new %s a unique id', (type) => {
    const ids = new Set([createElement(type, canvas).id, createElement(type, canvas).id])
    expect(ids.size).toBe(2)
  })

  it('honours a requested position', () => {
    expect(createElement('rect', canvas, { xMm: 7, yMm: 9 })).toMatchObject({ xMm: 7, yMm: 9 })
  })

  it('starts every element unrotated', () => {
    for (const type of ELEMENT_TYPES) {
      expect(createElement(type, canvas).rotation).toBe(0)
    }
  })
})

describe('printability of the defaults', () => {
  it('gives barcodes content that actually encodes', () => {
    // An empty barcode is rejected by the guards, which would mean a new
    // element arrives already broken.
    const barcode = createElement('barcode', canvas)
    expect('content' in barcode && barcode.content).toBeTruthy()
  })

  it('gives barcodes and QR codes a scannable module width', () => {
    for (const type of ['barcode', 'qrcode'] as const) {
      const element = createElement(type, canvas)
      expect('moduleWidthDots' in element && element.moduleWidthDots).toBeGreaterThanOrEqual(2)
    }
  })

  it('gives rules a stroke of at least one whole dot', () => {
    // Thinner than a dot is anti-aliased to grey and then thresholded away.
    for (const type of ['line', 'rect', 'ellipse'] as const) {
      const element = createElement(type, canvas)
      expect('strokeWidthDots' in element && element.strokeWidthDots).toBeGreaterThanOrEqual(1)
    }
  })

  it('makes a new ellipse an outline rather than a solid block', () => {
    expect(createElement('ellipse', canvas)).toMatchObject({ filled: false })
  })

  it('sizes elements to fit a small label', () => {
    const narrow = createBlankLabel(203, { widthMm: 25, heightMm: 15 })
    for (const type of ELEMENT_TYPES) {
      const element = createElement(type, narrow)
      if ('widthMm' in element) {
        expect(element.widthMm).toBeLessThanOrEqual(narrow.widthMm)
      }
    }
  })
})

describe('nextElementId', () => {
  it('never repeats', () => {
    const ids = Array.from({ length: 50 }, () => nextElementId('text'))
    expect(new Set(ids).size).toBe(50)
  })

  it('names the type, so ids are readable in a diff', () => {
    expect(nextElementId('barcode')).toMatch(/^barcode-/)
  })
})
