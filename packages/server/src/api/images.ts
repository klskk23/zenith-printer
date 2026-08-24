/**
 * Image upload and retrieval (FR-009).
 *
 * Files live on disk with only metadata in the database: a 2MB logo inside a
 * SQLite row would bloat every query that touches the table.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
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

export interface ImageRoutesOptions {
  /** Directory holding uploaded files. */
  storageDir: string
}

export async function registerImageRoutes(
  app: FastifyInstance,
  options: ImageRoutesOptions,
): Promise<void> {
  mkdirSync(options.storageDir, { recursive: true })
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })

  const typed = app.withTypeProvider<ZodTypeProvider>()
  const repo = (): ImageRepo => new ImageRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids, storageDir: options.storageDir })

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
    const extension = extname(file.filename) || (file.mimetype === 'image/png' ? '.png' : '.jpg')
    // Insert first so the id names the file; an orphan row is easier to reason
    // about than an orphan file.
    const asset = store.create({
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
    })
    const fileName = `${asset.id}${extension}`
    writeFileSync(join(options.storageDir, fileName), buffer)
    store.attachFile(asset.id, fileName)

    // Re-read so the response carries the resolved path rather than the empty
    // one `create` returned a moment ago.
    return reply.status(HttpStatus.Created).send(store.find(asset.id))
  })

  /**
   * Sweep uploaded images nothing points at any more (and files with no row).
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

    // Files the uploads directory holds and the database does not — what a
    // crash between writing the file and recording it leaves behind. Compared
    // against every row including the marked ones, so history's files are not
    // mistaken for strays.
    const known = new Set(images.map((image) => image.storagePath))
    const cutoff = app.ctx.clock.now().getTime() - minAgeHours * 60 * 60 * 1000
    const strays = readdirSync(options.storageDir)
      .map((name) => join(options.storageDir, name))
      .filter((path) => !known.has(path))
      .filter((path) => {
        try {
          const stat = statSync(path)
          return stat.isFile() && stat.mtimeMs <= cutoff
        } catch {
          return false
        }
      })

    if (!confirm) {
      return {
        outcome: 'planned' as const,
        removed: 0,
        strayFilesRemoved: 0,
        candidates: plan.remove.map((image) => ({ id: image.id, sizeBytes: image.sizeBytes })),
        strayFiles: strays.length,
        keptReferenced: plan.keptReferenced,
        keptTooNew: plan.keptTooNew,
        bytesFreed: plan.bytesFreed,
        minAgeHours,
      }
    }

    for (const image of plan.remove) {
      store.hardDelete(image.id)
      rmSync(image.storagePath, { force: true })
    }
    for (const path of strays) {
      rmSync(path, { force: true })
    }

    // Principle V: a maintenance action that deletes files says so in the log,
    // with enough to answer "what went, and when" months later.
    app.log.info(
      {
        event: 'images_pruned',
        removed: plan.remove.length,
        removedIds: plan.remove.map((image) => image.id),
        strayFilesRemoved: strays.length,
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
      strayFilesRemoved: strays.length,
      candidates: plan.remove.map((image) => ({ id: image.id, sizeBytes: image.sizeBytes })),
      strayFiles: strays.length,
      keptReferenced: plan.keptReferenced,
      keptTooNew: plan.keptTooNew,
      bytesFreed: plan.bytesFreed,
      minAgeHours,
    }
  })

  typed.get('/api/images/:id/content', { schema: { params: idParams } }, async (request, reply) => {
    // Soft-deleted assets still serve, so job history keeps rendering (FR-051).
    const asset = repo().find(request.params.id)
    if (asset === undefined) {
      throw ApiError.notFound({ imageId: request.params.id })
    }
    return reply.type(asset.mimeType).send(readFileSync(asset.storagePath))
  })

  typed.delete('/api/images/:id', { schema: { params: idParams } }, async (request, reply) => {
    const store = repo()
    const asset = store.find(request.params.id)
    if (asset === undefined) {
      throw ApiError.notFound({ imageId: request.params.id })
    }

    const { removedFromDisk } = store.delete(asset.id)
    if (removedFromDisk) {
      rmSync(asset.storagePath, { force: true })
    }
    return reply.status(HttpStatus.NoContent).send()
  })
}
