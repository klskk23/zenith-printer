/**
 * Preview endpoint.
 *
 * Renders through exactly the pipeline that drives the printer, so what the
 * user checks before committing stock is what the head will burn — including
 * the thresholding, where thin strokes and light greys disappear (FR-028).
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { labelIrSchema } from '@zenith/shared'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { maxLabelWidthMm } from '../domain/printer.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { renderLabel } from '../render/pipeline.ts'
import { loadFontConfig } from '../render/fonts.ts'
import { createImageResolver } from '../render/image-resolver.ts'
import { HALFTONE_MODES, type HalftoneMode } from '../render/dither.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { encodeMonochromePng } from '../render/png.ts'
import { ApiError } from './errors.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

const previewBody = z.object({
  printerId: z.string().min(1),
  ir: labelIrSchema,
  profileId: z.string().min(1).optional(),
  /**
   * Position correction in dots.
   *
   * Optional: when absent the printer's own stored offset is used, which is
   * what makes the preview show what will actually come out. An explicit value
   * is for the calibration screen, where the point is to preview a correction
   * before committing it.
   */
  offsetXDots: z.number().int().optional(),
  offsetYDots: z.number().int().optional(),
  threshold: z.number().int().min(1).max(255).optional(),
  /**
   * Overrides the chosen profile's halftone, so a setting can be compared
   * against the same artwork before it is saved.
   */
  halftone: z.enum(HALFTONE_MODES).optional(),
})

export async function registerPreviewRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const fonts = loadFontConfig(join(repoRoot, 'fonts'))

  typed.post('/api/preview', { schema: { body: previewBody } }, async (request, reply) => {
    const printers = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
    const printer = printers.find(request.body.printerId)
    if (printer === undefined) {
      throw ApiError.notFound({ printerId: request.body.printerId })
    }

    const capabilities = printer.capabilities
    if (capabilities === null) {
      throw ApiError.unprocessable('VALIDATION_FAILED', { printerId: printer.id })
    }

    const ir = request.body.ir
    const maxWidth = maxLabelWidthMm(capabilities)
    if (ir.widthMm > maxWidth + 1e-6) {
      throw ApiError.unprocessable('FIELD_VALIDATION_FAILED', {
        widthMm: ir.widthMm,
        maxLabelWidthMm: Number(maxWidth.toFixed(3)),
      })
    }

    // resvg has no HTTP client, so asset ids must become data URIs before
    // rendering. Without this the logo shows in the editor and silently
    // disappears from the printed label.
    const resolveImage = createImageResolver(
      new ImageRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }),
    )

    const result = renderLabel({
      ir,
      fonts,
      svgOptions: { resolveImage },
      // Correction belongs to the machine, so it comes from the printer unless
      // the caller is previewing a candidate value.
      offsetXDots: request.body.offsetXDots ?? printer.offsetXDots,
      offsetYDots: request.body.offsetYDots ?? printer.offsetYDots,
      ...(request.body.threshold === undefined ? {} : { threshold: request.body.threshold }),
      halftone: halftoneFor(app, request.body),
    })

    return reply
      .type('image/png')
      // Clipping is reported in headers so the editor can mark the lost region
      // without a second round trip (FR-006).
      .header('X-Clipped', String(result.hasClipping))
      .header('X-Clipped-Region', JSON.stringify(result.clipped))
      .header('X-Size-Dots', `${result.bitmap.widthDots}x${result.bitmap.heightDots}`)
      .send(encodeMonochromePng(result.bitmap))
  })
}


/**
 * Which halftone the preview should use.
 *
 * An explicit value wins, so a setting can be compared against the artwork
 * before it is saved. Otherwise it comes from the chosen profile, because a
 * preview that does not match what the profile will print is worse than no
 * preview: it is a preview that lies.
 */
function halftoneFor(
  app: FastifyInstance,
  body: { profileId?: string; halftone?: HalftoneMode },
): HalftoneMode {
  if (body.halftone !== undefined) {
    return body.halftone
  }
  if (body.profileId === undefined) {
    return 'none'
  }
  const profiles = new ProfileRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  return profiles.find(body.profileId)?.halftone ?? 'none'
}
