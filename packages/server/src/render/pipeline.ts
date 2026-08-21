/**
 * IR -> printable bitmap.
 *
 *   IR --[ @zenith/shared ir-to-svg ]--> SVG --[ resvg ]--> RGBA
 *       --[ offset ]--> --[ binarize ]--> BinaryBitmap
 *
 * The first arrow is shared verbatim with the browser, so the editor preview
 * and the printed label can only differ in how SVG becomes pixels.
 *
 * `loadSystemFonts` stays false and fonts come from bundled files. That is a
 * constitution requirement rather than a tuning knob: with system fonts the
 * same template renders differently on the developer's machine and the box in
 * the warehouse, and SC-010 requires them to be pixel-identical.
 */
import { Resvg } from '@resvg/resvg-js'
import { irToSvg, type IrToSvgOptions, type LabelIR } from '@zenith/shared'
import type { BinaryBitmap } from '../drivers/port.ts'
import { binarize } from './binarize.ts'
import { applyOffset, type ClippedRegion } from './offset.ts'

export interface FontConfig {
  /** Absolute paths to the bundled font files. */
  fontFiles: string[]
  defaultFontFamily: string
}

export interface RenderRequest {
  ir: LabelIR
  fonts: FontConfig
  /** Position correction, in whole dots (FR-026, FR-029). */
  offsetXDots?: number
  offsetYDots?: number
  /** Luminance cut-off; tuned against hardware verification #7. */
  threshold?: number
  svgOptions?: IrToSvgOptions
}

export interface RenderResult {
  bitmap: BinaryBitmap
  svg: string
  clipped: ClippedRegion
  hasClipping: boolean
  widthDots: number
  heightDots: number
}

export class RenderError extends Error {
  override readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'RenderError'
    this.cause = cause
  }
}

/** Rasterise a fully resolved IR. Variable references must already be replaced. */
export function renderLabel(request: RenderRequest): RenderResult {
  const svg = irToSvg(request.ir, request.svgOptions ?? {})

  let pixels: Uint8Array
  let widthDots: number
  let heightDots: number

  try {
    const resvg = new Resvg(svg, {
      font: {
        // Constitution ("Rendering determinism"): never read system fonts.
        loadSystemFonts: false,
        fontFiles: request.fonts.fontFiles,
        defaultFontFamily: request.fonts.defaultFontFamily,
      },
      // The SVG viewBox is already expressed in dots, so render one-to-one.
      fitTo: { mode: 'original' },
      background: 'white',
    })
    const rendered = resvg.render()
    // `pixels` is RGBA; see render/image-source.ts for why that matters.
    pixels = new Uint8Array(rendered.pixels)
    widthDots = rendered.width
    heightDots = rendered.height
  } catch (err) {
    throw new RenderError('failed to rasterise the label', err)
  }

  const binarized = binarize(pixels, widthDots, heightDots, { threshold: request.threshold })

  const offset = applyOffset(binarized, {
    offsetXDots: request.offsetXDots ?? 0,
    offsetYDots: request.offsetYDots ?? 0,
  })

  return {
    bitmap: offset.bitmap,
    svg,
    clipped: offset.clipped,
    hasClipping: offset.hasClipping,
    widthDots,
    heightDots,
  }
}
