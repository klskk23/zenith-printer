import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appliedMigrationIds,
  openDatabase,
  pendingMigrationIds,
  runMigrations,
  type Migration,
} from '../../src/db/index.ts'
import { backupBeforeMigrations, isFileBackedLocation } from '../../src/db/backup.ts'
import { migrations } from '../../src/db/migrations/index.ts'

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

describe('idempotence', () => {
  it('applies each migration exactly once', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    runMigrations(db)
    runMigrations(db)
    expect(appliedMigrationIds(db)).toEqual(migrations.map((m) => m.id))
  })

  it('leaves the schema unchanged when re-run', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    const before = tableNames(db)
    runMigrations(db)
    expect(tableNames(db)).toEqual(before)
  })

  it('applies migrations in id order regardless of array order', () => {
    const db = new DatabaseSync(':memory:')
    const out: Migration[] = [
      { id: 2, name: 'second', up: 'CREATE TABLE b (id TEXT PRIMARY KEY)' },
      { id: 1, name: 'first', up: 'CREATE TABLE a (id TEXT PRIMARY KEY)' },
    ]
    runMigrations(db, out)
    expect(appliedMigrationIds(db)).toEqual([1, 2])
  })
})

describe('atomicity', () => {
  it('rolls back a failing migration rather than leaving a partial schema', () => {
    const db = new DatabaseSync(':memory:')
    const broken: Migration[] = [
      { id: 1, name: 'ok', up: 'CREATE TABLE good (id TEXT PRIMARY KEY)' },
      { id: 2, name: 'broken', up: 'CREATE TABLE half (id TEXT PRIMARY KEY); THIS IS NOT SQL' },
    ]
    expect(() => runMigrations(db, broken)).toThrow(/migration 2/)
    // The first statement of the failed migration must not survive.
    expect(tableNames(db)).not.toContain('half')
    expect(appliedMigrationIds(db)).toEqual([1])
  })
})

describe('initial schema', () => {
  it('creates every entity table', () => {
    const db = openDatabase({ location: ':memory:' })
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['printers', 'profiles', 'templates', 'variable_fields', 'images', 'print_jobs']),
    )
  })

  it('enforces the idempotency key uniquely', () => {
    // A refresh must not burn a second batch of labels (FR-017).
    const db = openDatabase({ location: ':memory:' })
    const insert = db.prepare(
      `INSERT INTO print_jobs (id, idempotency_key, requested_copies, status, snapshot, created_at)
       VALUES (?, ?, 1, 'queued', '{}', '2026-01-01T00:00:00Z')`,
    )
    insert.run('j1', 'key-1')
    expect(() => insert.run('j2', 'key-1')).toThrow()
  })

  it('allows pages_printed to be null, distinct from zero', () => {
    // NULL is "unknown after a crash"; 0 is "nothing printed" (FR-053).
    const db = openDatabase({ location: ':memory:' })
    db.prepare(
      `INSERT INTO print_jobs (id, idempotency_key, requested_copies, pages_printed, status, snapshot, created_at)
       VALUES ('j1', 'k1', 10, NULL, 'failed', '{}', '2026-01-01T00:00:00Z')`,
    ).run()
    const row = db.prepare('SELECT pages_printed FROM print_jobs WHERE id = ?').get('j1')
    expect(row?.pages_printed).toBeNull()
  })

  it('rejects an unknown job status', () => {
    const db = openDatabase({ location: ':memory:' })
    expect(() =>
      db
        .prepare(
          `INSERT INTO print_jobs (id, idempotency_key, requested_copies, status, snapshot, created_at)
           VALUES ('j1', 'k1', 1, 'sideways', '{}', '2026-01-01T00:00:00Z')`,
        )
        .run(),
    ).toThrow()
  })

  it('keeps job history readable after its template is deleted', () => {
    // Deleting a template must not break the record of what was printed.
    const db = openDatabase({ location: ':memory:' })
    db.prepare(
      `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
       VALUES ('t1', 'label', 'niimbot', 50, 30, 203, '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run()
    db.prepare(
      `INSERT INTO print_jobs (id, idempotency_key, template_id, requested_copies, status, snapshot, created_at)
       VALUES ('j1', 'k1', 't1', 5, 'completed', '{"templateName":"label"}', '2026-01-01T00:00:00Z')`,
    ).run()

    db.prepare('DELETE FROM templates WHERE id = ?').run('t1')

    const row = db.prepare('SELECT template_id, snapshot FROM print_jobs WHERE id = ?').get('j1')
    expect(row?.template_id).toBeNull()
    expect(String(row?.snapshot)).toContain('label')
  })

  it('cascades profiles when their printer is removed', () => {
    const db = openDatabase({ location: ':memory:' })
    db.prepare(
      `INSERT INTO printers (id, name, kind, transport, address, created_at)
       VALUES ('p1', 'warehouse', 'niimbot', 'serial', '/dev/ttyACM0', '2026-01-01T00:00:00Z')`,
    ).run()
    db.prepare(
      `INSERT INTO profiles (id, printer_id, name, density, label_type, created_at)
       VALUES ('pr1', 'p1', 'thick stock', 4, 1, '2026-01-01T00:00:00Z')`,
    ).run()

    db.prepare('DELETE FROM printers WHERE id = ?').run('p1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()?.n).toBe(0)
  })
})

describe('pre-migration backup', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zenith-backup-'))

  it('skips in-memory databases, which is what every test uses', () => {
    expect(isFileBackedLocation(':memory:')).toBe(false)
    expect(backupBeforeMigrations(':memory:', '2', true)).toMatchObject({
      path: null,
      reason: 'not-file-backed',
    })
  })

  it('skips a database that does not exist yet', () => {
    const location = join(tmp, 'absent.db')
    expect(backupBeforeMigrations(location, '2', true)).toMatchObject({
      path: null,
      reason: 'no-existing-file',
    })
  })

  it('skips when the schema is already current', () => {
    const location = join(tmp, 'current.db')
    writeFileSync(location, 'not really sqlite, but a file')
    expect(backupBeforeMigrations(location, '2', false)).toMatchObject({
      path: null,
      reason: 'up-to-date',
    })
  })

  it('copies the file byte-for-byte before migrations run', () => {
    const location = join(tmp, 'live.db')
    const contents = 'original contents'
    writeFileSync(location, contents)

    const result = backupBeforeMigrations(location, '2', true)

    expect(result.reason).toBe('created')
    expect(result.path).toBe(`${location}.before-2.bak`)
    expect(readFileSync(result.path!, 'utf8')).toBe(contents)
    // The original must still be there — this is a copy, not a move.
    expect(readFileSync(location, 'utf8')).toBe(contents)
  })

  it('reports which migrations are pending', () => {
    const db = openDatabase({ location: ':memory:' })
    // openDatabase applies everything, so nothing should remain.
    expect(pendingMigrationIds(db)).toEqual([])
  })
})
