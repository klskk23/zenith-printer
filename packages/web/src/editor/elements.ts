/**
 * Element factories and metadata for the editor palette.
 *
 * Defaults are chosen so a newly dropped element is immediately printable:
 * strokes are a whole dot, sizes fit a small label, and barcodes carry sample
 * content. Dropping something that silently fails to print would be a poor
 * first impression of the tool.
 */
import { DEFAULT_MODULE_WIDTH_DOTS, type LabelElement, type LabelIR } from '@zenith/shared'

export const ELEMENT_TYPES = ['text', 'barcode', 'qrcode', 'image', 'line', 'rect'] as const
export type ElementType = (typeof ELEMENT_TYPES)[number]

export const FONT_FAMILIES = {
  sans: 'Noto Sans CJK SC',
  serif: 'Noto Serif CJK SC',
  mono: 'DejaVu Sans Mono',
} as const

export type FontFamilyKey = keyof typeof FONT_FAMILIES

let counter = 0

/** Ids only need to be unique within one label. */
export function nextElementId(type: ElementType): string {
  counter += 1
  return `${type}-${counter}`
}

export interface CreateOptions {
  xMm?: number
  yMm?: number
}

export function createElement(type: ElementType, ir: LabelIR, options: CreateOptions = {}): LabelElement {
  const xMm = options.xMm ?? 2
  const yMm = options.yMm ?? 2
  const id = nextElementId(type)

  switch (type) {
    case 'text':
      return {
        id,
        type: 'text',
        xMm,
        yMm,
        widthMm: Math.min(30, ir.widthMm - xMm),
        heightMm: 5,
        rotation: 0,
        content: 'Text',
        fontFamily: FONT_FAMILIES.sans,
        fontSizeMm: 3,
        bold: false,
        align: 'left',
      }

    case 'barcode':
      return {
        id,
        type: 'barcode',
        xMm,
        yMm,
        widthMm: Math.min(40, ir.widthMm - xMm),
        heightMm: 10,
        rotation: 0,
        content: '123456789',
        symbology: 'code128',
        showHumanReadable: true,
      }

    case 'qrcode':
      return {
        id,
        type: 'qrcode',
        xMm,
        yMm,
        widthMm: 15,
        heightMm: 15,
        rotation: 0,
        content: 'https://example.com',
        errorCorrectionLevel: 'M',
      }

    case 'image':
      return {
        id,
        type: 'image',
        xMm,
        yMm,
        widthMm: 15,
        heightMm: 15,
        rotation: 0,
        assetId: '',
        fit: 'contain',
      }

    case 'line':
      return {
        id,
        type: 'line',
        xMm,
        yMm,
        x2Mm: Math.min(xMm + 30, ir.widthMm),
        y2Mm: yMm,
        rotation: 0,
        // One whole dot: the thinnest mark that survives thresholding.
        strokeWidthDots: 1,
      }

    case 'rect':
      return {
        id,
        type: 'rect',
        xMm,
        yMm,
        widthMm: 20,
        heightMm: 10,
        rotation: 0,
        strokeWidthDots: 2,
        filled: false,
        cornerRadiusMm: 0,
      }
  }
}

/** A blank label sized for the most common stock. */
export function createBlankLabel(dpi: number): LabelIR {
  return { widthMm: 50, heightMm: 30, dpi, elements: [] }
}

export const DEFAULT_BARCODE_MODULE_WIDTH_DOTS = DEFAULT_MODULE_WIDTH_DOTS
