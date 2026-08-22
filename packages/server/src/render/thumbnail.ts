/**
 * The picture the template library shows for a design.
 *
 * Generated once, when the design is saved, and stored with it. The library
 * lists every template at once, so rendering on demand would mean one resvg
 * pass per card on every visit — for a picture that only changes when somebody
 * edits the design.
 *
 * Two deliberate differences from the printing path:
 *
 *   - **Not binarised.** A card is a few hundred pixels wide; thresholding a
 *     scaled-down render turns small text into speckle. The thumbnail says
 *     what the design *is*, and the preview — which is rendered at the
 *     printer's own resolution — says what it will look like printed.
 *   - **Rendered at a fixed pixel width**, not at the label's dot grid. The
 *     card is the same size whatever printer the design is destined for.
 *
 * Unresolved `${}` references are drawn as the literal text they are, which is
 * what `irToSvg` does everywhere. A thumbnail is not the place to go looking up
 * a row that will have changed by the time anybody looks at it.
 */
import { Resvg } from '@resvg/resvg-js'
import { irToSvg, type LabelIR } from '@zenith/shared'
import type { FontConfig } from './pipeline.ts'
import type { ImageResolver } from './image-resolver.ts'

/** Long edge, in pixels. Enough for a card at 2x without being a payload. */
export const THUMBNAIL_LONG_EDGE_PX = 320

export interface ThumbnailRequest {
  ir: LabelIR
  fonts: FontConfig
  resolveImage?: ImageResolver
}

/**
 * PNG bytes, or `null` when the design cannot be drawn.
 *
 * Null rather than throwing: a design whose barcode content the symbology
 * cannot encode is still a design somebody is allowed to save and come back
 * to. Losing the save over its picture would be the wrong trade, so the card
 * shows a placeholder instead.
 */
export function renderThumbnail(request: ThumbnailRequest): Uint8Array | null {
  const { ir, fonts } = request
  try {
    const svg = irToSvg(ir, request.resolveImage === undefined ? {} : { resolveImage: request.resolveImage })
    const landscape = ir.widthMm >= ir.heightMm
    const image = new Resvg(svg, {
      font: {
        // The same rule as printing: bundled fonts only, never the system's.
        loadSystemFonts: false,
        fontFiles: fonts.fontFiles,
        defaultFontFamily: fonts.defaultFontFamily,
      },
      fitTo: landscape
        ? { mode: 'width', value: THUMBNAIL_LONG_EDGE_PX }
        : { mode: 'height', value: THUMBNAIL_LONG_EDGE_PX },
      background: 'white',
    }).render()
    return new Uint8Array(image.asPng())
  } catch {
    return null
  }
}
