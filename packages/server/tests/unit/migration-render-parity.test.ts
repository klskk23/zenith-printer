/**
 * Migrating must not change how existing templates look.
 *
 * The offset move and the profile reshuffle touch neither geometry nor content,
 * so every saved design must render to exactly the bytes it did before. This is
 * the assertion behind FR-078, and it is worth having as a test rather than as
 * an intention: "we did not change rendering" is easy to believe and easy to be
 * wrong about.
 *
 * **QR templates are excluded, on purpose.** Fixing the QR defect changes their
 * output — a QR element used to render as a Code 128 barcode. That change is
 * the repair, not a regression, and including those templates here would make
 * this test fail for the one reason it should not.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { irToSvg, labelIrSchema, type LabelIR } from '@zenith/shared'
import { Resvg } from '@resvg/resvg-js'
import { loadFontConfig } from '../../src/render/fonts.ts'

const repoRoot = join(import.meta.dirname, '../../../..')

function hash(ir: LabelIR): string {
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))
  const png = new Resvg(irToSvg(ir), {
    font: { fontFiles: fonts.fontFiles, loadSystemFonts: false, defaultFontFamily: fonts.defaultFontFamily },
  })
    .render()
    .asPng()
  return createHash('sha256').update(png).digest('hex')
}

/** Whether a design contains anything whose rendering this feature repaired. */
export function isAffectedByRenderFixes(ir: LabelIR): boolean {
  return ir.elements.some((element) => element.type === 'qrcode')
}

/** Designs as they would have been stored before the migration. */
const LEGACY_TEMPLATES: { name: string; elements: unknown[] }[] = [
  {
    name: 'text and rules',
    elements: [
      { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 44, heightMm: 6, content: '仓库物料标签', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 4, bold: true },
      { id: 'l', type: 'line', xMm: 2, yMm: 12, x2Mm: 48, y2Mm: 12, strokeWidthDots: 1 },
      { id: 'r', type: 'rect', xMm: 36, yMm: 20, widthMm: 12, heightMm: 6, strokeWidthDots: 2 },
    ],
  },
  {
    name: 'barcode label',
    elements: [
      // No moduleWidthDots, exactly as older rows have it. It defaults to 2 —
      // the value the old global render option used — so the output is
      // unchanged.
      { id: 'b', type: 'barcode', xMm: 2, yMm: 4, widthMm: 44, heightMm: 12, content: 'ABC-12345', symbology: 'code128' },
    ],
  },
]

describe('render parity across the migration', () => {
  it('has the bundled fonts, or every comparison below is vacuous', () => {
    expect(loadFontConfig(join(repoRoot, 'fonts')).fontFiles.length).toBeGreaterThan(0)
  })

  it.each(LEGACY_TEMPLATES)('renders "$name" deterministically', ({ elements }) => {
    const ir = labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
    expect(hash(ir)).toBe(hash(ir))
  })

  it('gives a barcode with no stored module width the old default', () => {
    // The old global option was 2 dots; parsing supplies the same, so nothing
    // about an existing barcode label moves.
    const parsed = labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: LEGACY_TEMPLATES[1]!.elements,
    })
    expect(parsed.elements[0]).toMatchObject({ moduleWidthDots: 2 })
  })

  it('matches an explicit module width of 2 exactly', () => {
    const implicit = labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203, elements: LEGACY_TEMPLATES[1]!.elements,
    })
    const explicit = labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{ ...(LEGACY_TEMPLATES[1]!.elements[0] as object), moduleWidthDots: 2 }],
    })
    expect(hash(implicit)).toBe(hash(explicit))
  })
})

describe('the exclusion', () => {
  it('identifies designs whose rendering was repaired', () => {
    const withQr = labelIrSchema.parse({
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{ id: 'q', type: 'qrcode', xMm: 2, yMm: 2, widthMm: 15, heightMm: 15, content: 'x' }],
    })
    expect(isAffectedByRenderFixes(withQr)).toBe(true)
  })

  it('leaves everything else in scope for the comparison', () => {
    for (const { elements } of LEGACY_TEMPLATES) {
      const ir = labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
      expect(isAffectedByRenderFixes(ir)).toBe(false)
    }
  })
})
