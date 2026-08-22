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
import { evaluateIr, labelIrSchema, type LabelIR } from '@zenith/shared'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { maxLabelWidthMm } from '../domain/printer.ts'
import { PrinterRepo } from '../db/repositories/printer-repo.ts'
import { renderLabel } from '../render/pipeline.ts'
import { loadFontConfig } from '../render/fonts.ts'
import { createImageResolver } from '../render/image-resolver.ts'
import { HALFTONE_MODES, type HalftoneMode } from '../render/dither.ts'
import { DEFAULT_THRESHOLD } from '../render/binarize.ts'
import { ProfileRepo } from '../db/repositories/profile-repo.ts'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { encodeMonochromePng } from '../render/png.ts'
import { ApiError } from './errors.ts'
import { resolveContent } from './job-submission.ts'
import { TemplateRepo } from '../db/repositories/template-repo.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

const previewBody = z.object({
  printerId: z.string().min(1),
  ir: labelIrSchema,
  /**
   * Preview the stored template rather than the IR sent alongside it.
   *
   * A job submitted with a `templateId` prints the *saved* design, so an editor
   * with unsaved changes would otherwise preview one label and print another —
   * and a preview that shows something other than what prints is worse than no
   * preview at all.
   */
  templateId: z.string().min(1).optional(),
  /** Values for this copy's variable fields, so the preview is a real label. */
  variableValues: z.record(z.string(), z.string()).optional(),
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

    const ir = previewIr(app, request.body)
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
      // Both come from the chosen profile unless the caller overrides them, so
      // the preview shows what the print will do rather than what the defaults
      // would do.
      threshold: thresholdFor(app, request.body),
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


/** The threshold the preview should use; see `halftoneFor`. */
function thresholdFor(
  app: FastifyInstance,
  body: { profileId?: string; threshold?: number },
): number {
  if (body.threshold !== undefined) {
    return body.threshold
  }
  if (body.profileId === undefined) {
    return DEFAULT_THRESHOLD
  }
  const profiles = new ProfileRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  return profiles.find(body.profileId)?.threshold ?? DEFAULT_THRESHOLD
}


/**
 * The label this preview should show.
 *
 * The same content the job endpoint would build — from the stored template
 * when one is named, from the ad-hoc IR otherwise — with this copy's variable
 * values filled in. Anything less and the preview is of a different label.
 */
function previewIr(
  app: FastifyInstance,
  body: { ir: LabelIR; templateId?: string; variableValues?: Record<string, string> },
): LabelIR {
  let ir = body.ir
  if (body.templateId !== undefined) {
    const templates = new TemplateRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
    const template = templates.find(body.templateId)
    if (template === undefined) {
      throw ApiError.notFound({ templateId: body.templateId })
    }
    ir = resolveContent(template, null, null).ir
  }

  if (body.variableValues === undefined) {
    return ir
  }
  const { ir: evaluated, unresolved } = evaluateIr(ir, body.variableValues)
  if (unresolved.length > 0) {
    // Saying which name is missing beats rendering a label with "${sku}" on it.
    throw ApiError.unprocessable('VARIABLE_NOT_DEFINED', { reference: unresolved[0], references: unresolved })
  }
  return evaluated
}
