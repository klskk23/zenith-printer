import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let app: FastifyInstance
let storageDir: string

/** Smallest valid PNG: 1x1 transparent. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function multipartBody(filename: string, mimeType: string, content: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----zenithtest'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'zenith-img-'))
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    imageStorageDir: storageDir,
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('img'),
    logLevel: 'error',
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(storageDir, { recursive: true, force: true })
})

/**
 * Make a design name this asset — which is what "referenced" now means.
 *
 * It used to be `ImageRepo.addReference`, a counter nothing in the application
 * ever incremented; it read zero for every image, so every delete removed the
 * file. Pointing a stored design at the asset tests what actually decides.
 */
function referenceFromATemplate(assetId: string): void {
  app.ctx.db
    .prepare(
      `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
       VALUES ('tpl-ref', 't', 'niimbot', 50, 30, 203, ?, '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')`,
    )
    .run(JSON.stringify([{ id: 'e0', type: 'image', assetId }]))
}

async function upload(filename = 'logo.png', mimeType = 'image/png', content = PNG_1X1) {
  const { payload, headers } = multipartBody(filename, mimeType, content)
  return app.inject({ method: 'POST', url: '/api/images', payload, headers })
}

describe('upload', () => {
  it('stores a PNG and returns its metadata', async () => {
    const res = await upload()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ filename: 'logo.png', mimeType: 'image/png' })
  })

  it('writes the file to disk rather than into the database', async () => {
    // A multi-megabyte logo inside a row would slow every query on the table.
    const asset = (await upload()).json()
    expect(existsSync(asset.storagePath)).toBe(true)
  })

  it('rejects an unsupported format', async () => {
    const res = await upload('notes.txt', 'text/plain', Buffer.from('hello'))
    expect(res.statusCode).toBe(422)
    expect(res.json().details.mimeType).toBe('text/plain')
  })

  it('lists what was uploaded', async () => {
    await upload()
    expect((await app.inject({ method: 'GET', url: '/api/images' })).json().images).toHaveLength(1)
  })
})

describe('retrieval', () => {
  it('serves the stored bytes back', async () => {
    const asset = (await upload()).json()
    const res = await app.inject({ method: 'GET', url: `/api/images/${asset.id}/content` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.rawPayload.equals(PNG_1X1)).toBe(true)
  })

  it('returns 404 for an unknown id', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/images/nope/content' })).statusCode).toBe(404)
  })
})

describe('deletion and history', () => {
  it('removes an unreferenced image from disk', async () => {
    const asset = (await upload()).json()
    expect((await app.inject({ method: 'DELETE', url: `/api/images/${asset.id}` })).statusCode).toBe(204)
    expect(existsSync(asset.storagePath)).toBe(false)
  })

  it('keeps a referenced image resolvable after deletion', async () => {
    // FR-051: a snapshot can duplicate text but not a binary, so history would
    // break if the file actually went away.
    const asset = (await upload()).json()
    referenceFromATemplate(asset.id)

    await app.inject({ method: 'DELETE', url: `/api/images/${asset.id}` })

    expect(existsSync(asset.storagePath)).toBe(true)
    const res = await app.inject({ method: 'GET', url: `/api/images/${asset.id}/content` })
    expect(res.statusCode).toBe(200)
  })

  it('hides a soft-deleted image from the picker', async () => {
    const asset = (await upload()).json()
    referenceFromATemplate(asset.id)
    await app.inject({ method: 'DELETE', url: `/api/images/${asset.id}` })

    expect((await app.inject({ method: 'GET', url: '/api/images' })).json().images).toHaveLength(0)
  })

  it('returns 404 when deleting an unknown image', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/images/nope' })).statusCode).toBe(404)
  })
})
