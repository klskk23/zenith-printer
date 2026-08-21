/**
 * Sample label used by the `render-test` diagnostic command.
 *
 * Fixture data, not user-facing copy: it never reaches the i18n layer because
 * it is a rendering probe, not a message. The Chinese string is the point —
 * it exercises the bundled CJK font under `loadSystemFonts: false`.
 */
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import { FONT_FAMILIES } from '@zenith/server/src/render/fonts.ts'

export function sampleLabel(dpi: number, strokeWidthDots: number): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi,
    elements: [
      { id: 'title', type: 'text', xMm: 2, yMm: 1.5, widthMm: 46, heightMm: 6, content: '仓库物料标签', fontFamily: FONT_FAMILIES.sans, fontSizeMm: 4, bold: true },
      { id: 'code', type: 'barcode', xMm: 2, yMm: 8, widthMm: 46, heightMm: 11, content: 'ABC-12345', symbology: 'code128' },
      { id: 'rule', type: 'line', xMm: 2, yMm: 21, x2Mm: 48, y2Mm: 21, strokeWidthDots },
      { id: 'part', type: 'text', xMm: 2, yMm: 22, widthMm: 30, heightMm: 4, content: 'P/N ABC-12345', fontFamily: FONT_FAMILIES.mono, fontSizeMm: 3 },
      { id: 'box', type: 'rect', xMm: 36, yMm: 21.5, widthMm: 12, heightMm: 7, strokeWidthDots: 2 },
      { id: 'qty', type: 'text', xMm: 37, yMm: 23, widthMm: 10, heightMm: 4, content: 'x100', fontFamily: FONT_FAMILIES.sans, fontSizeMm: 3, align: 'center' },
    ],
  })
}
