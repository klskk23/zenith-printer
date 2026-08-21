/**
 * Label IR — the authoritative representation of a label design.
 *
 * Everything downstream (the editor, the renderer, both drivers, the job
 * snapshot) is derived from this shape, so the binarisation constraints live
 * here as schema rules rather than as conventions people are asked to respect:
 *
 *   - stroke widths are whole dots, minimum 1. Anything thinner is smeared by
 *     anti-aliasing and then removed entirely by thresholding (FR-008).
 *   - opacity, gradients and shadows are simply not expressible. Their
 *     behaviour after a hard threshold is not predictable, so the schema does
 *     not offer them at all.
 */
import { z } from 'zod'

/** Reference to a variable field, resolved at print time (FR-037). */
export const variableRefSchema = z.object({
  $var: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'field name must be an identifier'),
})
export type VariableRef = z.infer<typeof variableRefSchema>

/** Element content: either a literal, or a slot filled in at print time. */
export const contentSchema = z.union([z.string(), variableRefSchema])
export type Content = z.infer<typeof contentSchema>

export function isVariableRef(content: Content): content is VariableRef {
  return typeof content !== 'string'
}

export const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])

/** Whole dots, minimum 1 — see the note at the top of this file. */
export const strokeWidthDotsSchema = z
  .number()
  .int('stroke width must be a whole number of dots')
  .min(1, 'a stroke thinner than one dot is invisible after thresholding')

const baseElement = {
  id: z.string().min(1),
  xMm: z.number().finite(),
  yMm: z.number().finite(),
  rotation: rotationSchema.default(0),
}

const sized = {
  widthMm: z.number().finite().positive(),
  heightMm: z.number().finite().positive(),
}

export const BARCODE_SYMBOLOGIES = ['code128', 'code39', 'ean13', 'ean8', 'itf14'] as const
export const symbologySchema = z.enum(BARCODE_SYMBOLOGIES)
export type BarcodeSymbology = z.infer<typeof symbologySchema>

export const textAlignSchema = z.enum(['left', 'center', 'right'])
export const imageFitSchema = z.enum(['contain', 'cover', 'fill'])
export const eccSchema = z.enum(['L', 'M', 'Q', 'H'])

export const textElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('text'),
  content: contentSchema,
  fontFamily: z.string().min(1),
  fontSizeMm: z.number().finite().positive(),
  bold: z.boolean().default(false),
  align: textAlignSchema.default('left'),
})

export const barcodeElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('barcode'),
  content: contentSchema,
  symbology: symbologySchema,
  showHumanReadable: z.boolean().default(true),
})

export const qrcodeElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('qrcode'),
  content: contentSchema,
  errorCorrectionLevel: eccSchema.default('M'),
})

export const imageElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('image'),
  assetId: z.string().min(1),
  fit: imageFitSchema.default('contain'),
})

export const lineElementSchema = z.object({
  ...baseElement,
  type: z.literal('line'),
  x2Mm: z.number().finite(),
  y2Mm: z.number().finite(),
  strokeWidthDots: strokeWidthDotsSchema,
})

export const rectElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('rect'),
  strokeWidthDots: strokeWidthDotsSchema,
  filled: z.boolean().default(false),
  cornerRadiusMm: z.number().finite().min(0).default(0),
})

export const labelElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  barcodeElementSchema,
  qrcodeElementSchema,
  imageElementSchema,
  lineElementSchema,
  rectElementSchema,
])
export type LabelElement = z.infer<typeof labelElementSchema>
export type TextElement = z.infer<typeof textElementSchema>
export type BarcodeElement = z.infer<typeof barcodeElementSchema>
export type QrcodeElement = z.infer<typeof qrcodeElementSchema>
export type ImageElement = z.infer<typeof imageElementSchema>
export type LineElement = z.infer<typeof lineElementSchema>
export type RectElement = z.infer<typeof rectElementSchema>

export const labelIrSchema = z
  .object({
    widthMm: z.number().finite().positive(),
    heightMm: z.number().finite().positive(),
    dpi: z.number().int().positive(),
    elements: z.array(labelElementSchema),
  })
  .refine(
    (ir) => new Set(ir.elements.map((e) => e.id)).size === ir.elements.length,
    { message: 'element ids must be unique within a label', path: ['elements'] },
  )
export type LabelIR = z.infer<typeof labelIrSchema>

/** Elements that can carry a variable field (FR-037). */
export type VariableCapableElement = TextElement | BarcodeElement | QrcodeElement

export function isVariableCapable(element: LabelElement): element is VariableCapableElement {
  return element.type === 'text' || element.type === 'barcode' || element.type === 'qrcode'
}

/** Names of every variable field referenced by a label, in document order. */
export function referencedVariables(ir: LabelIR): string[] {
  const names: string[] = []
  for (const element of ir.elements) {
    if (isVariableCapable(element) && isVariableRef(element.content)) {
      if (!names.includes(element.content.$var)) {
        names.push(element.content.$var)
      }
    }
  }
  return names
}
