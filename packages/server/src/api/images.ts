/**
 * Image upload and retrieval (FR-009).
 *
 * Files live on disk with only metadata in the database: a 2MB logo inside a
 * SQLite row would bloat every query that touches the table.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { z } from 'zod'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { ImageRepo } from '../db/repositories/image-repo.ts'
import { ApiError, HttpStatus } from './errors.ts'

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg'])
const MAX_BYTES = 4 * 1024 * 1024

const idParams = z.object({ id: z.string().min(1) })

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
    const extension = extname(file.filename) || (file.mimetype === 'image/png' ? '.png' : '.jpg')
    // Insert first so the id names the file; an orphan row is easier to reason
    // about than an orphan file.
    const asset = store.create({
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
      storagePath: '',
    })
    const storagePath = join(options.storageDir, `${asset.id}${extension}`)
    writeFileSync(storagePath, buffer)
    app.ctx.db.prepare('UPDATE images SET storage_path = ? WHERE id = ?').run(storagePath, asset.id)

    return reply.status(HttpStatus.Created).send({ ...asset, storagePath })
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
