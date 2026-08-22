/**
 * Sweeping uploaded images nothing points at any more.
 *
 * Pasting a picture uploads it there and then, so every discarded paste, every
 * abandoned draft and every deleted template leaves a file behind. Without a
 * sweep the uploads directory only grows, and nothing in the interface ever
 * mentions it.
 *
 * The dangerous direction is the other one, and these tests are mostly about
 * that: an image still named by a template, by a job's record of what it
 * printed, or by an editor tab somebody has open but has not saved, must
 * survive.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

const HOUR = 60 * 60 * 1000
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

let app: FastifyInstance
let clock: FixedClock
let storageDir: string

function multipart(content: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----zenithtest'
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

beforeEach(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'zenith-prune-'))
  clock = new FixedClock('2026-08-23T00:00:00Z')
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    imageStorageDir: storageDir,
    clock,
    idGenerator: new SequentialIdGenerator('img'),
    logLevel: 'error',
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(storageDir, { recursive: true, force: true })
})

async function upload(): Promise<{ id: string; storagePath: string }> {
  const { payload, headers } = multipart(PNG_1X1)
  return (await app.inject({ method: 'POST', url: '/api/images', payload, headers })).json()
}

/** A template whose design names these assets. */
function templateNaming(...assetIds: string[]): void {
  app.ctx.db
    .prepare(
      `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
       VALUES ('tpl-1', 't', 'niimbot', 50, 30, 203, ?, '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')`,
    )
    .run(JSON.stringify(assetIds.map((assetId, i) => ({ id: `e${i}`, type: 'image', assetId }))))
}

/** A finished job whose record of what it printed names these assets. */
function jobNaming(...assetIds: string[]): void {
  app.ctx.db
    .prepare(
      `INSERT INTO print_jobs (id, idempotency_key, requested_copies, status, snapshot, created_at)
       VALUES ('job-1', 'k-1', 1, 'completed', ?, '2026-08-23T00:00:00Z')`,
    )
    .run(JSON.stringify({ ir: { elements: assetIds.map((assetId) => ({ type: 'image', assetId })) } }))
}

const prune = async (body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/images/prune', payload: body })

describe('reporting before removing', () => {
  it('says what it would remove and removes nothing', async () => {
    const asset = await upload()
    clock.advance(48 * HOUR)

    const res = await prune()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ outcome: 'planned', removed: 0 })
    expect(res.json().candidates).toHaveLength(1)
    expect(existsSync(asset.storagePath)).toBe(true)
  })

  it('removes only when asked in so many words', async () => {
    const asset = await upload()
    clock.advance(48 * HOUR)

    const res = await prune({ confirm: true })
    expect(res.json()).toMatchObject({ outcome: 'removed', removed: 1 })
    expect(existsSync(asset.storagePath)).toBe(false)
    expect((await app.inject({ method: 'GET', url: '/api/images' })).json().images).toHaveLength(0)
  })
})

describe('what survives', () => {
  it('keeps an image a template still names', async () => {
    const asset = await upload()
    templateNaming(asset.id)
    clock.advance(48 * HOUR)

    expect((await prune({ confirm: true })).json()).toMatchObject({ removed: 0, keptReferenced: 1 })
    expect(existsSync(asset.storagePath)).toBe(true)
  })

  it("keeps an image a job's record still names, with no template left", async () => {
    // The template was deleted; the job's snapshot is the only thing that
    // remembers. A snapshot can copy text and numbers but not a picture, so
    // removing the file would leave history unrenderable (FR-051).
    const asset = await upload()
    jobNaming(asset.id)
    clock.advance(48 * HOUR)

    expect((await prune({ confirm: true })).json()).toMatchObject({ removed: 0, keptReferenced: 1 })
    expect(existsSync(asset.storagePath)).toBe(true)
  })

  it('keeps a freshly pasted image that nothing names yet', async () => {
    // Pasting uploads immediately, so between the paste and the first save the
    // picture is referenced by nothing. Sweeping on references alone empties
    // it out of an editor somebody still has open.
    const asset = await upload()
    clock.advance(2 * HOUR)

    expect((await prune({ confirm: true })).json()).toMatchObject({ removed: 0, keptTooNew: 1 })
    expect(existsSync(asset.storagePath)).toBe(true)
  })

  it('lets the grace period be set for a one-off sweep', async () => {
    const asset = await upload()
    clock.advance(2 * HOUR)

    expect((await prune({ confirm: true, minAgeHours: 1 })).json()).toMatchObject({ removed: 1 })
    expect(existsSync(asset.storagePath)).toBe(false)
  })
})

describe('files with no row at all', () => {
  it('sweeps a file the uploads directory holds and the database does not', async () => {
    // What a crash between writing the file and recording it leaves behind.
    const stray = join(storageDir, 'stray.png')
    writeFileSync(stray, PNG_1X1)
    clock.advance(48 * HOUR)

    const res = await prune({ confirm: true })
    expect(res.json()).toMatchObject({ strayFilesRemoved: 1 })
    expect(existsSync(stray)).toBe(false)
  })

  it('leaves a file that belongs to a row alone', async () => {
    const asset = await upload()
    templateNaming(asset.id)
    clock.advance(48 * HOUR)

    await prune({ confirm: true })
    expect(readdirSync(storageDir)).toHaveLength(1)
  })
})

describe('refusing rather than guessing', () => {
  it('stops when a stored design cannot be read', async () => {
    // An unreadable row means an unknown reference set. Carrying on would
    // report its pictures as garbage, and they would be gone.
    const asset = await upload()
    app.ctx.db
      .prepare(
        `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
         VALUES ('tpl-bad', 't', 'niimbot', 50, 30, 203, '{not json', '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')`,
      )
      .run()
    clock.advance(48 * HOUR)

    expect((await prune({ confirm: true })).statusCode).toBe(422)
    expect(existsSync(asset.storagePath)).toBe(true)
  })
})

describe('deleting one image by hand', () => {
  it('keeps the file when history still needs it, and keeps serving it', async () => {
    // This was broken: the reference count it consulted was never incremented
    // by anything, so it read zero for every image and removed files a job's
    // history still pointed at.
    const asset = await upload()
    jobNaming(asset.id)

    expect((await app.inject({ method: 'DELETE', url: `/api/images/${asset.id}` })).statusCode).toBe(204)
    expect(existsSync(asset.storagePath)).toBe(true)
    expect((await app.inject({ method: 'GET', url: `/api/images/${asset.id}/content` })).statusCode).toBe(200)
    // Marked, so it is out of the picker without being out of history.
    expect((await app.inject({ method: 'GET', url: '/api/images' })).json().images).toHaveLength(0)
  })

  it('removes the file when nothing points at it', async () => {
    const asset = await upload()
    expect((await app.inject({ method: 'DELETE', url: `/api/images/${asset.id}` })).statusCode).toBe(204)
    expect(existsSync(asset.storagePath)).toBe(false)
  })
})
