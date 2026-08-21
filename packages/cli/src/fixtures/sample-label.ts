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

/**
 * Single-element probes for verifying one thing at a time.
 *
 * `sampleLabel` above is a whole label and good for judging a print as a whole.
 * These exist because the questions this feature raised are narrower: "is the
 * QR element actually a QR code", "does the module width change anything".
 */
export type ProbeElement = 'qrcode' | 'barcode' | 'ellipse' | 'multiline'

export function probeLabel(
  element: ProbeElement,
  dpi: number,
  moduleWidthDots: number,
  content: string,
): LabelIR {
  const elements: Record<ProbeElement, unknown> = {
    // Sized to the full label height on purpose. A QR side is quantised to
    // whole multiples of the module count, so a box too small for the requested
    // module width silently renders at a smaller one — which would make a
    // "compare 2 / 3 / 4 dots" experiment produce two identical labels.
    qrcode: {
      id: 'probe', type: 'qrcode', xMm: 2, yMm: 1, widthMm: 28, heightMm: 28,
      content, errorCorrectionLevel: 'M', moduleWidthDots,
    },
    barcode: {
      id: 'probe', type: 'barcode', xMm: 2, yMm: 2, widthMm: 46, heightMm: 14,
      content, symbology: 'code128', showHumanReadable: true, moduleWidthDots,
    },
    ellipse: {
      id: 'probe', type: 'ellipse', xMm: 2, yMm: 2, widthMm: 30, heightMm: 20,
      strokeWidthDots: moduleWidthDots, filled: false,
    },
    multiline: {
      id: 'probe', type: 'text', xMm: 2, yMm: 2, widthMm: 46, heightMm: 24,
      content, fontFamily: FONT_FAMILIES.sans, fontSizeMm: 3,
    },
  }

  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi, elements: [elements[element]] })
}

/**
 * Default content per probe. Fixture data, not user-facing copy — the Chinese
 * line is the point: it exercises the bundled CJK font in a multi-line layout.
 */
export function defaultProbeContent(element: ProbeElement): string {
  switch (element) {
    case 'qrcode':
      return 'https://example.com'
    case 'barcode':
      return 'ABC-12345'
    case 'multiline':
      return 'First line\nSecond line\n第三行'
    case 'ellipse':
      return ''
  }
}
