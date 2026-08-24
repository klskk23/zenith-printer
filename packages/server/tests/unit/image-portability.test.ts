/**
 * An image has to survive being moved to another machine.
 *
 * `storage_path` used to hold the absolute path the file had at upload time —
 * `/home/someone/zenith-printer/data/uploads/<id>.png`. Copy the data directory
 * to a server where it lives at `/data/uploads`, or into the container where it
 * always does, and every row points somewhere that does not exist: the
 * templates are intact, the ids still match, and not one picture renders.
 *
 * So the column holds a filename and the directory comes from the deployment.
 * Storage is where the row lives; where the *files* live is a property of the
 * machine, and a machine cannot be recorded inside a file that gets copied off
 * it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Database } from '../../src/db/index.ts'
import { ImageRepo } from '../../src/db/repositories/image-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let db: Database
let dirA: string
let dirB: string

function repoOn(storageDir: string): ImageRepo {
  return new ImageRepo({
    db,
    storageDir,
    clock: new FixedClock('2026-08-24T00:00:00Z'),
    ids: new SequentialIdGenerator('img'),
  })
}

beforeEach(() => {
  db = openDatabase({ location: ':memory:' })
  dirA = mkdtempSync(join(tmpdir(), 'zenith-a-'))
  dirB = mkdtempSync(join(tmpdir(), 'zenith-b-'))
})

afterEach(() => {
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
})

function seed(storageDir: string): string {
  const repo = repoOn(storageDir)
  const asset = repo.create({ filename: 'logo.png', mimeType: 'image/png', sizeBytes: 3 })
  repo.attachFile(asset.id, `${asset.id}.png`)
  writeFileSync(join(storageDir, `${asset.id}.png`), Buffer.from([1, 2, 3]))
  return asset.id
}

describe('what the column holds', () => {
  it('stores a filename, not a path', () => {
    const id = seed(dirA)
    const stored = db.prepare('SELECT storage_path FROM images WHERE id = ?').get(id) as {
      storage_path: string
    }
    expect(stored.storage_path).toBe(`${id}.png`)
    expect(stored.storage_path).not.toContain('/')
  })
})

describe('reading it back', () => {
  it('resolves against the directory this deployment uses', () => {
    const id = seed(dirA)
    expect(repoOn(dirA).find(id)?.storagePath).toBe(join(dirA, `${id}.png`))
  })

  it('follows the files when the whole data directory moves', () => {
    // The scenario, in one assertion: the same rows, a different machine.
    const id = seed(dirA)
    expect(repoOn(dirB).find(id)?.storagePath).toBe(join(dirB, `${id}.png`))
  })

  it('does the same for every listing, not just find', () => {
    // The sweep reads `all()` and unlinks what it returns. Resolving there
    // against the wrong directory would delete nothing and report success —
    // or, on a machine that happened to have a file of that name, the wrong one.
    const id = seed(dirA)
    expect(repoOn(dirB).all().map((image) => image.storagePath)).toEqual([join(dirB, `${id}.png`)])
    expect(repoOn(dirB).list().map((image) => image.storagePath)).toEqual([join(dirB, `${id}.png`)])
  })

  it('still resolves a row written before this was fixed', () => {
    // A database that has been through the migration holds filenames. One that
    // has not — restored from a backup, say — holds absolute paths from
    // somebody else's machine, and joining those onto the storage directory
    // would produce nonsense. Only the last segment is ever used.
    const id = seed(dirA)
    db.prepare('UPDATE images SET storage_path = ? WHERE id = ?').run(
      `/home/someone-else/project/data/uploads/${id}.png`,
      id,
    )
    expect(repoOn(dirB).find(id)?.storagePath).toBe(join(dirB, `${id}.png`))
  })
})

describe('the migration', () => {
  it('rewrites the absolute paths an older database holds', () => {
    // Written the way migration 13 left it, then reopened so 14 runs.
    const file = mkdtempSync(join(tmpdir(), 'zenith-mig-'))
    const location = join(file, 'old.db')
    const old = openDatabase({ location })
    old.prepare(
      `INSERT INTO images (id, filename, mime_type, size_bytes, storage_path, created_at)
       VALUES ('img-1', 'logo.png', 'image/png', 3, ?, '2026-08-24T00:00:00Z')`,
    ).run('/home/someone/zenith-printer/data/uploads/img-1.png')
    db.prepare('SELECT 1').get() // keep the shared db in scope untouched
    old.prepare('UPDATE schema_migrations SET id = id WHERE 1 = 0').run()
    old.close()

    // Simulate a database that stopped at 13: drop the record of 14 and reopen.
    const reopened = openDatabase({ location })
    reopened
      .prepare('UPDATE images SET storage_path = ? WHERE id = ?')
      .run('/home/someone/zenith-printer/data/uploads/img-1.png', 'img-1')
    reopened.prepare('DELETE FROM schema_migrations WHERE id = 14').run()
    reopened.close()

    const migrated = openDatabase({ location })
    const row = migrated.prepare('SELECT storage_path FROM images WHERE id = ?').get('img-1') as {
      storage_path: string
    }
    expect(row.storage_path).toBe('img-1.png')
    migrated.close()
    rmSync(file, { recursive: true, force: true })
  })
})
