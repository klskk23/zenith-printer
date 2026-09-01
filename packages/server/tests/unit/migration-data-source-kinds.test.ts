/**
 * Migration 16, and the data loss it is ordered to avoid.
 *
 * It rebuilds `data_sources`, because SQLite cannot alter the CHECK that names
 * the kinds of origin and `http` has to become one of them.
 *
 * `data_source_rows` references that table **ON DELETE CASCADE**. Dropping the
 * parent to rebuild it fires an implicit DELETE FROM, and the cascade takes
 * every row of every data source with it — silently, in a migration that then
 * reports success. So the child is copied aside and dropped first.
 *
 * A migration test on an empty database would pass either way. These seed rows
 * first, which is the only version of this test worth having.
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/index.ts'
import { migrations } from '../../src/db/migrations/index.ts'

const BEFORE = migrations.filter((m) => m.id <= 15)

/** A database on migration 15 with two sources and rows under each. */
function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db, BEFORE)

  const source = db.prepare(
    `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at, source_kind)
     VALUES (?, ?, ?, ?, 'T', 'T', ?)`,
  )
  source.run('ds-1', '本地表', JSON.stringify(['sn']), 3, 'local')
  source.run('ds-2', '表格表', JSON.stringify(['sn']), 2, 'google-sheets')

  const row = db.prepare(
    'INSERT INTO data_source_rows (source_id, ordinal, values_json) VALUES (?, ?, ?)',
  )
  for (let i = 1; i <= 3; i += 1) row.run('ds-1', i, JSON.stringify({ sn: `A-${i}` }))
  for (let i = 1; i <= 2; i += 1) row.run('ds-2', i, JSON.stringify({ sn: `B-${i}` }))
  return db
}

const rowCount = (db: DatabaseSync, sourceId: string): number =>
  Number(
    (db.prepare('SELECT COUNT(*) n FROM data_source_rows WHERE source_id = ?').get(sourceId) as { n: number }).n,
  )

describe('rebuilding the parent table', () => {
  it('keeps every row of every source', () => {
    // The whole reason for the order the migration is written in.
    const db = seeded()
    runMigrations(db, migrations)

    expect(rowCount(db, 'ds-1')).toBe(3)
    expect(rowCount(db, 'ds-2')).toBe(2)
  })

  it('keeps the values, not just the count', () => {
    const db = seeded()
    runMigrations(db, migrations)
    const values = db
      .prepare('SELECT values_json FROM data_source_rows WHERE source_id = ? ORDER BY ordinal')
      .all('ds-1')
      .map((row) => JSON.parse(String((row as { values_json: string }).values_json)).sn)
    expect(values).toEqual(['A-1', 'A-2', 'A-3'])
  })

  it('keeps the sources themselves, kind included', () => {
    const db = seeded()
    runMigrations(db, migrations)
    const kinds = db
      .prepare('SELECT id, source_kind FROM data_sources ORDER BY id')
      .all()
      .map((row) => `${String((row as { id: string }).id)}:${String((row as { source_kind: string }).source_kind)}`)
    expect(kinds).toEqual(['ds-1:local', 'ds-2:google-sheets'])
  })

  it('leaves the cascade in place for a real delete', () => {
    // Rebuilt, not removed: deleting a source must still take its rows.
    const db = seeded()
    runMigrations(db, migrations)
    db.prepare('DELETE FROM data_sources WHERE id = ?').run('ds-1')
    expect(rowCount(db, 'ds-1')).toBe(0)
    expect(rowCount(db, 'ds-2')).toBe(2)
  })
})

/**
 * Pinned to migration 16 rather than to the whole chain.
 *
 * 18 replaces the generic `http` kind with the ledger-backed one and drops the
 * columns 16 added, so asserting these against the *final* schema would assert
 * that 18 never happened. Run at 16, they say what 16 did — which is what makes
 * a chain of migrations checkable step by step rather than only at the end.
 */
const THROUGH_SIXTEEN = migrations.filter((m) => m.id <= 16)

describe('what the rebuild is for', () => {
  it('accepts http as a kind of origin', () => {
    const db = seeded()
    runMigrations(db, THROUGH_SIXTEEN)
    expect(() =>
      db
        .prepare(
          `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at, source_kind)
           VALUES ('ds-3', 'http 表', '["sn"]', 0, 'T', 'T', 'http')`,
        )
        .run(),
    ).not.toThrow()
  })

  it('still refuses a kind nobody implemented', () => {
    const db = seeded()
    runMigrations(db, THROUGH_SIXTEEN)
    expect(() =>
      db
        .prepare(
          `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at, source_kind)
           VALUES ('ds-4', '?', '["sn"]', 0, 'T', 'T', 'ftp')`,
        )
        .run(),
    ).toThrow()
  })

  it('defaults every existing source to manual refresh only', () => {
    // The behaviour this product had before there was any other option.
    const db = seeded()
    runMigrations(db, THROUGH_SIXTEEN)
    const row = db.prepare('SELECT refresh_interval_seconds i, refresh_before_print b, key_column k FROM data_sources WHERE id = ?').get('ds-1')
    expect(row).toMatchObject({ i: 0, b: 0, k: null })
  })
})

describe('the key index', () => {
  const withKeys = (): DatabaseSync => {
    const db = seeded()
    runMigrations(db, migrations)
    return db
  }

  it('refuses two rows of one source sharing a key', () => {
    // Ambiguity here would make "update the row with this key" pick one.
    const db = withKeys()
    db.prepare('UPDATE data_source_rows SET row_key = ? WHERE source_id = ? AND ordinal = 1').run('k1', 'ds-1')
    expect(() =>
      db.prepare('UPDATE data_source_rows SET row_key = ? WHERE source_id = ? AND ordinal = 2').run('k1', 'ds-1'),
    ).toThrow()
  })

  it('lets two different sources use the same key', () => {
    const db = withKeys()
    db.prepare('UPDATE data_source_rows SET row_key = ? WHERE source_id = ? AND ordinal = 1').run('k1', 'ds-1')
    expect(() =>
      db.prepare('UPDATE data_source_rows SET row_key = ? WHERE source_id = ? AND ordinal = 1').run('k1', 'ds-2'),
    ).not.toThrow()
  })

  it('does not constrain the sources that have no key at all', () => {
    // Partial index: every row migrated in has a null key, and there are many.
    const db = withKeys()
    expect(rowCount(db, 'ds-1')).toBe(3)
    const nulls = db.prepare('SELECT COUNT(*) n FROM data_source_rows WHERE row_key IS NULL').get()
    expect((nulls as { n: number }).n).toBe(5)
  })
})


/**
 * Migration 18: the ledger-backed origin, which keeps almost nothing.
 *
 * Same ordering hazard as 16 and the same test for it, because the parent is
 * rebuilt again. The addition is what happens to a source created under the
 * generic `http` kind that 18 removes: its rows must survive, since the rows
 * are the part nobody can get back.
 */
describe('the ledger-backed origin', () => {
  /** A database on 17, with a source of the generic kind that 18 removes. */
  function onSeventeen(): DatabaseSync {
    const db = seeded()
    runMigrations(db, migrations.filter((m) => m.id <= 17))
    db.prepare(
      `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at,
                                 source_kind, url, headers_json, key_column)
       VALUES ('ds-http', 'http 表', '["sys_id"]', 0, 'T', 'T', 'http', 'http://x/r', '{}', 'sys_id')`,
    ).run()
    const row = db.prepare(
      'INSERT INTO data_source_rows (source_id, ordinal, values_json, row_key) VALUES (?, ?, ?, ?)',
    )
    for (let i = 1; i <= 4; i += 1) row.run('ds-http', i, JSON.stringify({ sys_id: `k-${i}` }), `k-${i}`)
    return db
  }

  it('keeps every row of every source, again', () => {
    const db = onSeventeen()
    runMigrations(db, migrations)
    expect(rowCount(db, 'ds-1')).toBe(3)
    expect(rowCount(db, 'ds-2')).toBe(2)
    expect(rowCount(db, 'ds-http')).toBe(4)
  })

  it('keeps the keys, so identity survives the rebuild', () => {
    const db = onSeventeen()
    runMigrations(db, migrations)
    const keys = db
      .prepare('SELECT row_key FROM data_source_rows WHERE source_id = ? ORDER BY ordinal')
      .all('ds-http')
      .map((row) => String((row as { row_key: string }).row_key))
    expect(keys).toEqual(['k-1', 'k-2', 'k-3', 'k-4'])
  })

  it('turns a source of the removed kind into an ordinary table', () => {
    // Its address is no longer stored anywhere, so there is nothing else
    // honest to do — and its rows are the part nobody can get back.
    const db = onSeventeen()
    runMigrations(db, migrations)
    const kind = db.prepare('SELECT source_kind k FROM data_sources WHERE id = ?').get('ds-http')
    expect((kind as { k: string }).k).toBe('local')
  })

  it('accepts the ledger as a kind of origin', () => {
    const db = onSeventeen()
    runMigrations(db, migrations)
    expect(() =>
      db
        .prepare(
          `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at, source_kind, category_id)
           VALUES ('ds-n', '路由器', '["sys_id"]', 0, 'T', 'T', 'nexus', 'cat-1')`,
        )
        .run(),
    ).not.toThrow()
  })

  it('no longer accepts the generic kind it replaced', () => {
    const db = onSeventeen()
    runMigrations(db, migrations)
    expect(() =>
      db
        .prepare(
          `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at, source_kind)
           VALUES ('ds-x', '?', '["a"]', 0, 'T', 'T', 'http')`,
        )
        .run(),
    ).toThrow()
  })

  it('has nowhere left to store an address or a key', () => {
    // The point of the migration: a copy of a deployment decision drifts from
    // the decision. A column that does not exist cannot hold one.
    const db = onSeventeen()
    runMigrations(db, migrations)
    const columns = db
      .prepare('SELECT * FROM data_sources LIMIT 1')
      .all()
      .flatMap((row) => Object.keys(row as Record<string, unknown>))
    for (const gone of ['url', 'headers_json', 'key_column']) {
      expect(columns).not.toContain(gone)
    }
  })
})
