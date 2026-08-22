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
      expect.arrayContaining([
        'printers', 'profiles', 'templates', 'images', 'print_jobs',
        'data_sources', 'data_source_rows', 'sequence_pools', 'job_sequence_claims',
      ]),
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

/**
 * Migrations 7–10 — variables and table data sources.
 *
 * The destructive half (dropping variable_fields and print_jobs.seq_ranges) is
 * only acceptable because there is no production data yet. What must survive is
 * everything measured against physical hardware: printers, print settings, and
 * above all the offset correction, which somebody read off a misaligned label
 * with a ruler.
 */
function columnNames(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row.name))
}

function indexNames(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((row) => String(row.name))
}

describe('migrations 7-10: variables and data sources', () => {
  it('creates the four new tables', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    const tables = tableNames(db)
    expect(tables).toContain('data_sources')
    expect(tables).toContain('data_source_rows')
    expect(tables).toContain('sequence_pools')
    expect(tables).toContain('job_sequence_claims')
  })

  it('indexes job_sequence_claims by pool so the current value is not a table scan', () => {
    // The pool's current value is derived by taking MAX(end) over claims. A
    // pool is shared across designs, so that query cannot be narrowed by
    // template any more — without this index every submission scans history.
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT MAX(end_value) FROM job_sequence_claims WHERE pool_id = ?')
      .all()
      .map((row) => String(row.detail))
      .join(' ')
    expect(plan).toMatch(/USING (COVERING )?INDEX/i)
    expect(indexNames(db, 'job_sequence_claims').length).toBeGreaterThan(0)
  })

  it('adds variables and data_source_id to templates', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    const columns = columnNames(db, 'templates')
    expect(columns).toContain('variables')
    expect(columns).toContain('data_source_id')
  })

  it('drops the variable_fields table', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    expect(tableNames(db)).not.toContain('variable_fields')
  })

  it('drops print_jobs.seq_ranges, leaving claims as the only record of a number', () => {
    // Two places recording the same serial can disagree, and when they do
    // there is no way to tell which one went onto a label.
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    expect(columnNames(db, 'print_jobs')).not.toContain('seq_ranges')
  })

  it('cascades data_source_rows when its data source goes', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db)
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare('INSERT INTO data_sources (id,name,columns,row_count,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
      'ds1', '订单表', '["订单号"]', 1, 'T', 'T',
    )
    db.prepare('INSERT INTO data_source_rows (source_id,ordinal,values_json) VALUES (?,?,?)').run(
      'ds1', 1, '{"订单号":"A-001"}',
    )
    db.prepare('DELETE FROM data_sources WHERE id = ?').run('ds1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM data_source_rows').get()?.n).toBe(0)
  })

  it('preserves printers, print settings and the offset correction', () => {
    // The offset was measured against a physical label with a ruler. Losing it
    // means re-measuring on every machine.
    const db = new DatabaseSync(':memory:')
    runMigrations(db, migrations.filter((m) => m.id <= 6))

    db.prepare(
      `INSERT INTO printers (id,name,kind,transport,address,dpi,printhead_pixels,density_min,density_max,
         density_default,print_direction,supports_consumable_level,offset_x_dots,offset_y_dots,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('p1', '车间机', 'niimbot', 'serial', '/dev/ttyACM0', 203, 384, 1, 5, 3, 'top', 1, 7, -4, 'T')
    db.prepare(
      `INSERT INTO profiles (id,printer_id,name,density,label_type,speed,is_default,halftone,threshold,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('pr1', 'p1', '默认', 4, 2, 3, 1, 'ordered', 137, 'T')

    runMigrations(db)

    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get('p1')
    expect(printer).toMatchObject({
      name: '车间机', kind: 'niimbot', address: '/dev/ttyACM0', dpi: 203,
      density_default: 3, offset_x_dots: 7, offset_y_dots: -4,
    })
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get('pr1')
    expect(profile).toMatchObject({ density: 4, label_type: 2, speed: 3, halftone: 'ordered', threshold: 137 })
  })
})

describe('migration 10: content rewrite', () => {
  it('rewrites { $var: x } into ${x}', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, migrations.filter((m) => m.id <= 6))
    db.prepare(
      `INSERT INTO templates (id,name,version,printer_kind,width_mm,height_mm,dpi,elements,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('t1', '旧设计', 1, 'niimbot', 50, 30, 203, JSON.stringify([
      { id: 'a', type: 'text', xMm: 1, yMm: 1, widthMm: 20, heightMm: 5, content: { $var: 'serial' }, fontFamily: 'F', fontSizeMm: 3 },
      { id: 'b', type: 'text', xMm: 1, yMm: 8, widthMm: 20, heightMm: 5, content: 'plain', fontFamily: 'F', fontSizeMm: 3 },
    ]), 'T', 'T')

    runMigrations(db)

    const elements = JSON.parse(String(db.prepare('SELECT elements FROM templates WHERE id = ?').get('t1')?.elements))
    expect(elements[0].content).toBe('${serial}')
    expect(elements[1].content).toBe('plain')
  })

  it('escapes a literal ${ that predates the grammar', () => {
    // Otherwise content that used to print "${x}" starts resolving as a
    // reference — the label changes meaning with nothing anywhere saying so.
    const db = new DatabaseSync(':memory:')
    runMigrations(db, migrations.filter((m) => m.id <= 6))
    db.prepare(
      `INSERT INTO templates (id,name,version,printer_kind,width_mm,height_mm,dpi,elements,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('t2', '含字面花括号', 1, 'niimbot', 50, 30, 203, JSON.stringify([
      { id: 'a', type: 'text', xMm: 1, yMm: 1, widthMm: 20, heightMm: 5, content: '成本 ${x} 元', fontFamily: 'F', fontSizeMm: 3 },
    ]), 'T', 'T')

    runMigrations(db)

    const elements = JSON.parse(String(db.prepare('SELECT elements FROM templates WHERE id = ?').get('t2')?.elements))
    expect(elements[0].content).toBe('成本 $${x} 元')
  })
})
