/**
 * SQLite access via Node's built-in `node:sqlite`.
 *
 * Chosen over better-sqlite3 to avoid a node-gyp build step: the constitution
 * requires native module prerequisites to be documented, and the cheapest way
 * to satisfy that is to have none. At this scale — single-digit printers,
 * single-digit users, a few thousand job rows — the built-in is ample.
 */
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations/index.ts'

export interface Migration {
  id: number
  name: string
  up: string
}

export type Database = DatabaseSync

export interface OpenDatabaseOptions {
  /** File path, or ':memory:' for tests. */
  location: string
}

/**
 * Open a database and bring it up to the latest schema.
 * Migrations are recorded so re-running is a no-op.
 */
export function openDatabase(options: OpenDatabaseOptions): Database {
  const db = new DatabaseSync(options.location)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  runMigrations(db)
  return db
}

export function runMigrations(db: Database, list: Migration[] = migrations): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => Number(row.id)),
  )

  const record = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')

  for (const migration of [...list].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) {
      continue
    }
    // Each migration is atomic: a partially applied schema is worse than none.
    db.exec('BEGIN')
    try {
      db.exec(migration.up)
      record.run(migration.id, migration.name, new Date(0).toISOString())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${migration.id} (${migration.name}) failed: ${String(err)}`)
    }
  }
}

export function appliedMigrationIds(db: Database): number[] {
  return db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => Number(row.id))
}
