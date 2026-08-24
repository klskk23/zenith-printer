/**
 * Image upload and retrieval (FR-009).
 *
 * The bytes live in the row (migration 15). The original arrangement kept them
 * on disk to stop a 2MB logo riding along on every query that touched the
 * table — that concern is real and is answered by naming columns rather than by
 * a second store: see ImageRepo, where nothing selects `*`.
 */
import { z } from 'zod'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { UnreadableDesignError } from '../domain/image-references.ts'
import { planImageCleanup } from '../domain/image-cleanup.ts'
import { ApiError, HttpStatus } from './errors.ts'

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_BYTES = 4 * 1024 * 1024

const idParams = z.object({ id: z.string().min(1) })

/**
 * How old an unreferenced image must be before the sweep will take it.
 *
 * Twenty-four hours because pasting a picture uploads it immediately: from the
 * paste until the design is first saved, the file is referenced by nothing at
 * all. A day covers an editor tab left open over lunch, over a meeting, and
 * overnight — and the cost of being wrong is somebody's work, while the cost of
 * waiting is a few megabytes.
 */
const DEFAULT_MIN_AGE_HOURS = 24

const pruneBody = z.object({
  /**
   * Absent or false reports and removes nothing. Deleting files is not undoable
   * and the interface offers no way back, so it takes a word rather than a
   * default.
   */
  confirm: z.boolean().default(false),
  minAgeHours: z.number().finite().min(0).max(24 * 365).default(DEFAULT_MIN_AGE_HOURS),
})

export async function registerImageRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })

  const typed = app.withTypeProvider<ZodTypeProvider>()
  const repo = (): ImageRepo => new ImageRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })

  typed.get('/api/images', async () => ({ images: repo().list() }))

  app.post('/api/images', async (request, reply) => {
    const file = await request.file()
    if (file === undefined) {
      throw ApiError.fromCode(HttpStatus.BadRequest, 'VALIDATION_FAILED', { reason: 'no file' })
    }

    if (!ACCEPTED_TYPES.has(file.mimetype)) {
      throw ApiError.unprocessable('VALIDATION_FAILED', {
        mimeType: file.mimetype,
        accepted: [...ACCEPTED_TYPES],
      })
    }

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_BYTES) {
      throw ApiError.unprocessable('VALIDATION_FAILED', { sizeBytes: buffer.length, maxBytes: MAX_BYTES })
    }

    const store = repo()
    // Insert first, then the bytes: the id is minted by the insert, and nothing
    // before it knows which row the picture belongs to.
    const asset = store.create({
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
    })
    store.attachBytes(asset.id, buffer)

    return reply.status(HttpStatus.Created).send(asset)
  })

  /**
   * Sweep uploaded images nothing points at any more.
   *
   * Still needed with the bytes in the rows, and needed more than before:
   * pasting a picture uploads it immediately, so every discarded paste leaves a
   * row — and that row now carries the picture, so an abandoned 4MB paste grows
   * the database rather than sitting in a directory. What the move did retire
   * is the other half of the old sweep, which had to go looking for files with
   * no row at all.
   *
   * Reports by default; `confirm` performs it. The report is the same
   * calculation as the removal, so what it lists is what would go.
   */
  typed.post('/api/images/prune', { schema: { body: pruneBody } }, async (request) => {
    const store = repo()
    const { confirm, minAgeHours } = request.body

    let referenced: Set<string>
    try {
      referenced = store.referencedAssetIds()
    } catch (err) {
      if (err instanceof UnreadableDesignError) {
        // Refuse the whole sweep. An unreadable design means an unknown
        // reference set, and proceeding would report live pictures as garbage.
        throw ApiError.unprocessable('IMAGE_PRUNE_UNREADABLE_DESIGN', { reason: err.message })
      }
      throw err
    }

    const images = store.all()
    const plan = planImageCleanup(images, referenced, app.ctx.clock.now(), minAgeHours * 60 * 60 * 1000)

    if (!confirm) {
      return {
        outcome: 'planned' as const,
        removed: 0,
        candidates: plan.remove.map((image) => ({ id: image.id, sizeBytes: image.sizeBytes })),
        keptReferenced: plan.keptReferenced,
        keptTooNew: plan.keptTooNew,
        bytesFreed: plan.bytesFreed,
        minAgeHours,
      }
    }

    // One store, so one delete. There is no second place for a file to be left
    // behind, and no scan of the filesystem to find the ones that were.
    for (const image of plan.remove) {
      store.hardDelete(image.id)
    }

    // Principle V: a maintenance action that destroys data says so in the log,
    // with enough to answer "what went, and when" months later.
    app.log.info(
      {
        event: 'images_pruned',
        removed: plan.remove.length,
        removedIds: plan.remove.map((image) => image.id),
        bytesFreed: plan.bytesFreed,
        keptReferenced: plan.keptReferenced,
        keptTooNew: plan.keptTooNew,
        minAgeHours,
      },
      'pruned unreferenced images',
    )

    return {
      outcome: 'removed' as const,
      removed: plan.remove.length,
      candidates: plan.remove.map((image) => ({ id: image.id, sizeBytes: image.sizeBytes })),
      keptReferenced: plan.keptReferenced,
      keptTooNew: plan.keptTooNew,
      bytesFreed: plan.bytesFreed,
      minAgeHours,
    }
  })

  typed.get('/api/images/:id/content', { schema: { params: idParams } }, async (request, reply) => {
    // Soft-deleted assets still serve, so job history keeps rendering (FR-051).
    const store = repo()
    const asset = store.find(request.params.id)
    const bytes = asset === undefined ? undefined : store.bytes(asset.id)
    if (asset === undefined || bytes === undefined) {
      throw ApiError.notFound({ imageId: request.params.id })
    }
    return reply.type(asset.mimeType).send(bytes)
  })

  typed.delete('/api/images/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = repo()
    const asset = store.find(request.params.id)
    if (asset === undefined) {
      throw ApiError.notFound({ imageId: request.params.id })
    }

    // The row carries the bytes, so removing it removes them. Nothing else to
    // unlink, and nothing left over if this crashes half-way.
    store.delete(asset.id)
    return reply.status(HttpStatus.NoContent).send()
  })
}
