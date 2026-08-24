/**
 * Images live in the database.
 *
 * They used to be files on disk with a row pointing at them, and every problem
 * that arrangement had was a problem of keeping two things in step: a path that
 * meant nothing on another machine, files with no row, rows with no file, and a
 * backup that was only complete if you remembered the second directory.
 *
 * One store, and those questions stop being askable. The headline is the last
 * test here: copy `zenith.db` and nothing else, open it somewhere with no
 * uploads directory at all, and the pictures are still there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

let app: FastifyInstance
let dir: string

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
  dir = mkdtempSync(join(tmpdir(), 'zenith-blob-'))
  app = buildApp({
    db: openDatabase({ location: join(dir, 'zenith.db') }),
    clock: new FixedClock('2026-08-24T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('img'),
    logLevel: 'error',
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

async function upload(): Promise<{ id: string }> {
  const { payload, headers } = multipart(PNG_1X1)
  return (await app.inject({ method: 'POST', url: '/api/images', payload, headers })).json()
}

describe('where the bytes go', () => {
  it('into the row, not onto the disk', async () => {
    const asset = await upload()
    const row = app.ctx.db.prepare('SELECT bytes FROM images WHERE id = ?').get(asset.id) as {
      bytes: Uint8Array
    }
    expect(Buffer.from(row.bytes).equals(PNG_1X1)).toBe(true)
  })

  it('writes no file anywhere', async () => {
    // The uploads directory is the thing being retired. Leaving a copy behind
    // would mean the old questions — which one is authoritative, who deletes
    // the other — quietly survive the change.
    await upload()
    expect(existsSync(join(dir, 'uploads'))).toBe(false)
  })

  it('serves them back', async () => {
    const asset = await upload()
    const res = await app.inject({ method: 'GET', url: `/api/images/${asset.id}/content` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.rawPayload.equals(PNG_1X1)).toBe(true)
  })

  it('keeps the listing light', async () => {
    // The reason the original design put files on disk: a multi-megabyte logo
    // inside a row would ride along on every query that touches the table. The
    // bytes are in the row now, so the listing has to name its columns.
    await upload()
    const listed = (await app.inject({ method: 'GET', url: '/api/images' })).json().images
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('bytes')
  })
})

describe('the database is the whole backup', () => {
  it('serves a picture from a copy of the .db file alone', async () => {
    // The point of the change, in one assertion. No uploads directory is
    // copied, and none exists at the destination.
    const asset = await upload()
    const original = (await app.inject({ method: 'GET', url: `/api/images/${asset.id}/content` }))
      .rawPayload

    // Checkpoint first. The database runs in WAL mode, so the newest writes
    // live in `zenith.db-wal` until they are folded in — copy the main file
    // out from under a running service and you get a database missing whatever
    // happened most recently. That is what stopping the service before a copy
    // is for, and it is unchanged by the bytes moving into the rows: what the
    // move retired is the *second directory*, not the checkpoint.
    app.ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    const elsewhere = mkdtempSync(join(tmpdir(), 'zenith-restored-'))
    copyFileSync(join(dir, 'zenith.db'), join(elsewhere, 'zenith.db'))

    const restored = buildApp({
      db: openDatabase({ location: join(elsewhere, 'zenith.db') }),
      logLevel: 'error',
    })
    await restored.ready()
    try {
      const res = await restored.inject({ method: 'GET', url: `/api/images/${asset.id}/content` })
      expect(res.statusCode).toBe(200)
      expect(res.rawPayload.equals(original)).toBe(true)
    } finally {
      await restored.close()
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

describe('migrating a database that still has files', () => {
  it('moves the bytes in, and leaves the files where they are', async () => {
    // Rebuilt into the pre-15 shape by hand — bytes on disk, a filename in the
    // row — then reopened so 15 runs against it.
    const old = mkdtempSync(join(tmpdir(), 'zenith-old-'))
    const uploads = join(old, 'uploads')
    const location = join(old, 'zenith.db')

    const staged = openDatabase({ location })
    staged.exec('ALTER TABLE images ADD COLUMN storage_path TEXT NOT NULL DEFAULT \'\'')
    staged.exec('ALTER TABLE images DROP COLUMN bytes')
    staged
      .prepare(
        `INSERT INTO images (id, filename, mime_type, size_bytes, storage_path, created_at)
         VALUES ('img-old', 'logo.png', 'image/png', ?, 'img-old.png', '2026-08-24T00:00:00Z')`,
      )
      .run(PNG_1X1.length)
    staged.prepare('DELETE FROM schema_migrations WHERE id = 15').run()
    staged.close()

    const file = join(uploads, 'img-old.png')
    mkdirSync(uploads, { recursive: true })
    writeFileSync(file, PNG_1X1)

    const migrated = openDatabase({ location, imageStorageDir: uploads })
    const row = migrated.prepare('SELECT bytes FROM images WHERE id = ?').get('img-old') as {
      bytes: Uint8Array
    }
    expect(Buffer.from(row.bytes).equals(PNG_1X1)).toBe(true)
    // storage_path is gone: a table that could be read two ways is a table
    // every query has to cope with twice.
    expect(
      migrated.prepare('PRAGMA table_info(images)').all().map((c) => (c as { name: string }).name),
    ).not.toContain('storage_path')
    migrated.close()

    // Not deleted. Deciding somebody's uploads directory can go is one `rm -rf`
    // after they have seen the pictures still working, not a migration's call.
    expect(existsSync(file)).toBe(true)

    rmSync(old, { recursive: true, force: true })
  })

  it('keeps a row whose file had already gone, with no bytes', async () => {
    // Dropping it would turn "this picture is missing" into "this label never
    // had one", and a job's snapshot may still name it. The row survives, the
    // renderer skips the element, and the log says which ids to go looking for.
    const old = mkdtempSync(join(tmpdir(), 'zenith-lost-'))
    const location = join(old, 'zenith.db')

    const staged = openDatabase({ location })
    staged.exec("ALTER TABLE images ADD COLUMN storage_path TEXT NOT NULL DEFAULT ''")
    staged.exec('ALTER TABLE images DROP COLUMN bytes')
    staged
      .prepare(
        `INSERT INTO images (id, filename, mime_type, size_bytes, storage_path, created_at)
         VALUES ('img-lost', 'gone.png', 'image/png', 10, 'gone.png', '2026-08-24T00:00:00Z')`,
      )
      .run()
    staged.prepare('DELETE FROM schema_migrations WHERE id = 15').run()
    staged.close()

    const migrated = openDatabase({ location, imageStorageDir: join(old, 'uploads') })
    const row = migrated.prepare('SELECT bytes FROM images WHERE id = ?').get('img-lost') as {
      bytes: Uint8Array | null
    }
    expect(row).toBeDefined()
    expect(row.bytes).toBeNull()
    migrated.close()

    rmSync(old, { recursive: true, force: true })
  })
})
