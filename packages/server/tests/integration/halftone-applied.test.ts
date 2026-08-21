/**
 * Halftoning reaching the label.
 *
 * The rule itself is covered in `dither.test.ts`; this file is about the path.
 * Every defect this project has had in this area has been the same one — a
 * setting stored, shown, and never delivered — so what is checked here is that
 * the profile's choice arrives at the pixels, and only inside the images.
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { renderLabel } from '../../src/render/pipeline.ts'
import { loadFontConfig } from '../../src/render/fonts.ts'
import { countSetDots, isDotSet } from '../../src/render/binarize.ts'
import type { BinaryBitmap } from '../../src/drivers/port.ts'

const fonts = loadFontConfig(join(process.cwd(), 'fonts'))

/** A mid-grey PNG, as a data URI — the tone a hard threshold cannot express. */
function greyImage(): string {
  // 1x1 mid grey, scaled up by resvg to whatever box it is given.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  return `data:image/png;base64,${png}`
}

function labelWithImage(): LabelIR {
  return labelIrSchema.parse({
    widthMm: 40,
    heightMm: 20,
    dpi: 203,
    elements: [
      { id: 'img', type: 'image', xMm: 5, yMm: 5, widthMm: 20, heightMm: 10, assetId: 'a', fit: 'fill' },
    ],
  })
}

function render(ir: LabelIR, halftone?: 'none' | 'floyd-steinberg' | 'ordered'): BinaryBitmap {
  return renderLabel({
    ir,
    fonts,
    svgOptions: { resolveImage: () => greyImage() },
    ...(halftone === undefined ? {} : { halftone }),
  }).bitmap
}

describe('an image of flat grey', () => {
  /**
   * The behaviour being replaced. A mid grey is above the threshold, so the
   * whole picture disappears — which is what makes photographs unprintable
   * without this.
   */
  it('vanishes entirely under a hard threshold', () => {
    expect(countSetDots(render(labelWithImage(), 'none'))).toBe(0)
  })

  it.each(['floyd-steinberg', 'ordered'] as const)('comes out as dots under %s', (mode) => {
    const dots = countSetDots(render(labelWithImage(), mode))
    expect(dots).toBeGreaterThan(0)

    // Roughly half of the image's area, because the grey is roughly half way.
    const imageDots = Math.round((20 * 203) / 25.4) * Math.round((10 * 203) / 25.4)
    expect(dots / imageDots).toBeGreaterThan(0.2)
    expect(dots / imageDots).toBeLessThan(0.8)
  })

  it('defaults to leaving it alone', () => {
    // Nothing changes for a label that never asked for this.
    expect(countSetDots(render(labelWithImage()))).toBe(0)
  })
})

describe('what halftoning is allowed to touch', () => {
  /**
   * Text is solid black by construction; its only greys are the anti-aliased
   * fringe around each glyph. Halftoning that fringe frays every letter, so
   * the hard threshold has to keep its job everywhere outside an image.
   */
  it('leaves text exactly as it was', () => {
    const ir = labelIrSchema.parse({
      widthMm: 40,
      heightMm: 20,
      dpi: 203,
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 30, heightMm: 6,
          content: 'HALFTONE', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 4,
          bold: false, align: 'left',
        },
      ],
    })

    const plain = render(ir, 'none')
    const dithered = render(ir, 'floyd-steinberg')
    expect([...dithered.data]).toEqual([...plain.data])
  })

  it('leaves the paper around an image alone', () => {
    const bitmap = render(labelWithImage(), 'floyd-steinberg')
    const toDots = (mm: number): number => Math.round((mm * 203) / 25.4)

    // A column well clear of the image, top to bottom.
    for (let y = 0; y < bitmap.heightDots; y += 1) {
      expect(isDotSet(bitmap, toDots(35), y), `column outside the image at y=${y}`).toBe(false)
    }
  })

  it('leaves a barcode alone, which is what keeps it scannable', () => {
    // Stray dots in the quiet zones between bars are read as data.
    const ir = labelIrSchema.parse({
      widthMm: 40,
      heightMm: 20,
      dpi: 203,
      elements: [
        {
          id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 30, heightMm: 10,
          content: 'ABC-12345', symbology: 'code128', moduleWidthDots: 2,
        },
      ],
    })
    expect([...render(ir, 'ordered').data]).toEqual([...render(ir, 'none').data])
  })
})

describe('determinism', () => {
  it('renders the same label the same way twice', () => {
    // Constitution: the same template must render identically after a
    // redeploy, which rules out anything order- or time-dependent in here.
    const first = render(labelWithImage(), 'floyd-steinberg')
    const second = render(labelWithImage(), 'floyd-steinberg')
    expect([...first.data]).toEqual([...second.data])
  })

  it('gives the two screens genuinely different results', () => {
    const fs = render(labelWithImage(), 'floyd-steinberg')
    const ordered = render(labelWithImage(), 'ordered')
    expect([...fs.data]).not.toEqual([...ordered.data])
  })
})
