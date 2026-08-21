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
import { labelIrSchema, mmToDots } from '@zenith/shared'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { maxLabelWidthMm } from '../domain/printer.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { renderLabel } from '../render/pipeline.ts'
import { loadFontConfig } from '../render/fonts.ts'
import { createImageResolver } from '../render/image-resolver.ts'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { encodeMonochromePng } from '../render/png.ts'
import { ApiError } from './errors.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

const previewBody = z.object({
  printerId: z.string().min(1),
  ir: labelIrSchema,
  profileId: z.string().min(1).optional(),
  offsetXMm: z.number().finite().default(0),
  offsetYMm: z.number().finite().default(0),
  threshold: z.number().int().min(1).max(255).optional(),
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
      // Offsets are stored in millimetres and applied in whole dots; the UI
      // steps in dots so nobody has to type multiples of 0.125mm.
      offsetXDots: mmToDots(request.body.offsetXMm, ir.dpi),
      offsetYDots: mmToDots(request.body.offsetYMm, ir.dpi),
      ...(request.body.threshold === undefined ? {} : { threshold: request.body.threshold }),
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
