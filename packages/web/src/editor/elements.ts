/**
 * Element factories and metadata for the editor palette.
 *
 * Defaults are chosen so a newly dropped element is immediately printable:
 * strokes are a whole dot, sizes fit a small label, and barcodes carry sample
 * content. Dropping something that silently fails to print would be a poor
 * first impression of the tool.
 */
import { DEFAULT_MODULE_WIDTH_DOTS, type LabelElement, type LabelIR } from '@zenith/shared'

export const ELEMENT_TYPES = ['text', 'barcode', 'qrcode', 'image', 'line', 'rect', 'ellipse'] as const
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

/**
 * An id no element in this label already holds.
 *
 * The counter alone is not enough. It starts at zero on every page load, so
 * opening a template that contains `text-1` and then adding a text element
 * produced a second `text-1` — and two elements sharing an id means selecting
 * one selects both, and editing one edits both.
 */
export function uniqueElementId(ir: LabelIR, type: ElementType): string {
  const taken = new Set(ir.elements.map((element) => element.id))
  let id = nextElementId(type)
  while (taken.has(id)) {
    id = nextElementId(type)
  }
  return id
}

/**
 * Move an element by a millimetre delta.
 *
 * A line is defined by two points, so moving it means moving both. Leaving the
 * far end behind stretches the line instead of moving it — the kind of rule
 * that has to live in one place, because the second copy is the one that gets
 * forgotten.
 */
export function translateElement(
  element: LabelElement,
  deltaXMm: number,
  deltaYMm: number,
): LabelElement {
  if (element.type === 'line') {
    return {
      ...element,
      xMm: element.xMm + deltaXMm,
      yMm: element.yMm + deltaYMm,
      x2Mm: element.x2Mm + deltaXMm,
      y2Mm: element.y2Mm + deltaYMm,
    }
  }
  return { ...element, xMm: element.xMm + deltaXMm, yMm: element.yMm + deltaYMm }
}

export interface CreateOptions {
  xMm?: number
  yMm?: number
}

export function createElement(type: ElementType, ir: LabelIR, options: CreateOptions = {}): LabelElement {
  const xMm = options.xMm ?? 2
  const yMm = options.yMm ?? 2
  const id = uniqueElementId(ir, type)

  switch (type) {
    case 'text':
      return {
        id,
        type: 'text',
        // Normal ink by default; the switch is in the inspector and the
        // right-click menu.
        inverted: false,
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
        moduleWidthDots: DEFAULT_MODULE_WIDTH_DOTS,
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
        moduleWidthDots: DEFAULT_MODULE_WIDTH_DOTS,
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
        // Normal ink by default; the switch is in the inspector and the
        // right-click menu.
        inverted: false,
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
        // Normal ink by default; the switch is in the inspector and the
        // right-click menu.
        inverted: false,
        xMm,
        yMm,
        widthMm: 20,
        heightMm: 10,
        rotation: 0,
        strokeWidthDots: 2,
        filled: false,
        cornerRadiusMm: 0,
      }

    case 'ellipse':
      return {
        id,
        type: 'ellipse',
        // Normal ink by default; the switch is in the inspector and the
        // right-click menu.
        inverted: false,
        xMm,
        yMm,
        widthMm: 20,
        heightMm: 12,
        rotation: 0,
        strokeWidthDots: 2,
        filled: false,
      }
  }
}

/** A blank label. Defaults suit the most common stock; preferences override them. */
export function createBlankLabel(
  dpi: number,
  size: { widthMm: number; heightMm: number } = { widthMm: 50, heightMm: 30 },
): LabelIR {
  return { widthMm: size.widthMm, heightMm: size.heightMm, dpi, elements: [] }
}

export const DEFAULT_BARCODE_MODULE_WIDTH_DOTS = DEFAULT_MODULE_WIDTH_DOTS
