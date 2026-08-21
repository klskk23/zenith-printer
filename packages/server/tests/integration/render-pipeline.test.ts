import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { renderLabel } from '../../src/render/pipeline.ts'
import { loadFontConfig, FONT_FAMILIES } from '../../src/render/fonts.ts'
import { countSetDots, isDotSet } from '../../src/render/binarize.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fonts = loadFontConfig(join(repoRoot, 'fonts'))

function ir(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

describe('determinism', () => {
  it('renders byte-identical bitmaps for identical input', () => {
    // SC-010: the same template must survive a redeploy unchanged.
    const label = ir([
      { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 6, content: 'ABC-12345', fontFamily: FONT_FAMILIES.sans, fontSizeMm: 4 },
      { id: 'b', type: 'barcode', xMm: 2, yMm: 10, widthMm: 40, heightMm: 12, content: 'ABC-12345', symbology: 'code128' },
    ])
    const first = renderLabel({ ir: label, fonts })
    const second = renderLabel({ ir: label, fonts })
    expect(Array.from(first.bitmap.data)).toEqual(Array.from(second.bitmap.data))
  })

  it('renders the canvas at exactly the dot dimensions', () => {
    const result = renderLabel({ ir: ir([]), fonts })
    expect(result.widthDots).toBe(400)
    expect(result.heightDots).toBe(240)
  })
})

describe('content', () => {
  it('produces marks for Chinese text', () => {
    // The bundled CJK font is the only reason this works; system fonts are off.
    const result = renderLabel({
      ir: ir([
        { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 46, heightMm: 8, content: '仓库标签', fontFamily: FONT_FAMILIES.sans, fontSizeMm: 6 },
      ]),
      fonts,
    })
    expect(countSetDots(result.bitmap)).toBeGreaterThan(100)
  })

  it('produces marks for a barcode', () => {
    const result = renderLabel({
      ir: ir([
        { id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 15, content: 'ABC-12345', symbology: 'code128' },
      ]),
      fonts,
    })
    expect(countSetDots(result.bitmap)).toBeGreaterThan(100)
  })

  it('keeps a one-dot rule visible end to end', () => {
    // The full-pipeline counterpart of the binarize unit test: FR-008's
    // guarantee has to survive rasterisation, not just thresholding.
    const result = renderLabel({
      ir: ir([{ id: 'l', type: 'line', xMm: 5, yMm: 15, x2Mm: 45, y2Mm: 15, strokeWidthDots: 1 }]),
      fonts,
    })
    expect(countSetDots(result.bitmap)).toBeGreaterThan(300)
  })

  it('leaves an empty label blank', () => {
    expect(countSetDots(renderLabel({ ir: ir([]), fonts }).bitmap)).toBe(0)
  })
})

describe('offset', () => {
  it('shifts the rendered content', () => {
    const label = ir([{ id: 'r', type: 'rect', xMm: 0, yMm: 0, widthMm: 5, heightMm: 5, strokeWidthDots: 2, filled: true }])
    const plain = renderLabel({ ir: label, fonts })
    const shifted = renderLabel({ ir: label, fonts, offsetXDots: 20, offsetYDots: 0 })
    expect(isDotSet(plain.bitmap, 1, 1)).toBe(true)
    expect(isDotSet(shifted.bitmap, 1, 1)).toBe(false)
    expect(isDotSet(shifted.bitmap, 21, 1)).toBe(true)
  })

  it('reports clipping so the editor can mark it', () => {
    const label = ir([{ id: 'r', type: 'rect', xMm: 0, yMm: 0, widthMm: 5, heightMm: 5, strokeWidthDots: 2, filled: true }])
    const result = renderLabel({ ir: label, fonts, offsetXDots: -10, offsetYDots: 0 })
    expect(result.hasClipping).toBe(true)
    expect(result.clipped.left).toBeGreaterThan(0)
  })
})

describe('font configuration', () => {
  it('names every missing file rather than rendering tofu', () => {
    expect(() => loadFontConfig('/nonexistent/fonts')).toThrow(/fetch-fonts/)
  })
})
