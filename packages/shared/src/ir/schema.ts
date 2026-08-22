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

/**
 * Element content: a template string.
 *
 * It used to be `string | { $var }` — a slot either held literal text or was
 * bound, wholesale, to one variable. That shape could not express "零件
 * ${sku} 号", and it made "is this element bound?" a concept the editor, the
 * renderer and the print form each had to agree about. References are now
 * inline (`${名称}`) and parsed by `@zenith/shared/template`, so content is
 * just a string and binding is not a property of an element at all.
 */
export const contentSchema = z.string()
export type Content = z.infer<typeof contentSchema>

export const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
export type Rotation = z.infer<typeof rotationSchema>

/**
 * Barcode and QR module width, in whole dots.
 *
 * The minimum of 2 comes from the scanning spec, not from what can be drawn:
 * at 203 dpi 2 dots is 0.25 mm, the usual Code 128 X-dimension, and the spec
 * floor is around 0.19 mm. A single dot renders perfectly well and simply
 * cannot be read back.
 *
 * Odd widths are fine. An earlier version of this codebase required an even
 * width; that rule was measured to be unnecessary and has been removed.
 */
export const moduleWidthDotsSchema = z
  .number()
  .int('module width must be a whole number of dots')
  .min(2, 'a module narrower than 2 dots is below the scanning floor')
  .default(2)

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
  // The rendered width is moduleWidthDots x moduleCount; `widthMm` above is a
  // derived estimate used for overflow checks, not an input to rendering.
  moduleWidthDots: moduleWidthDotsSchema,
})

export const qrcodeElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('qrcode'),
  content: contentSchema,
  errorCorrectionLevel: eccSchema.default('M'),
  // Side length is quantised the same way barcodes are: the module count
  // depends on both the content and the error-correction level.
  moduleWidthDots: moduleWidthDotsSchema,
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

/**
 * Described by its bounding box rather than centre plus radii, so that the
 * property panel, selection box and resize handles are shared with `rect`
 * unchanged. A circle is an ellipse with equal sides — no separate type.
 */
export const ellipseElementSchema = z.object({
  ...baseElement,
  ...sized,
  type: z.literal('ellipse'),
  strokeWidthDots: strokeWidthDotsSchema,
  filled: z.boolean().default(false),
})

export const labelElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  barcodeElementSchema,
  qrcodeElementSchema,
  imageElementSchema,
  lineElementSchema,
  rectElementSchema,
  ellipseElementSchema,
])
export type LabelElement = z.infer<typeof labelElementSchema>
export type TextElement = z.infer<typeof textElementSchema>
export type BarcodeElement = z.infer<typeof barcodeElementSchema>
export type QrcodeElement = z.infer<typeof qrcodeElementSchema>
export type ImageElement = z.infer<typeof imageElementSchema>
export type LineElement = z.infer<typeof lineElementSchema>
export type RectElement = z.infer<typeof rectElementSchema>
export type EllipseElement = z.infer<typeof ellipseElementSchema>

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

/** Elements whose content can carry `${}` references. */
export type ContentElement = TextElement | BarcodeElement | QrcodeElement

export function hasContent(element: LabelElement): element is ContentElement {
  return element.type === 'text' || element.type === 'barcode' || element.type === 'qrcode'
}
