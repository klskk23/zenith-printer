/**
 * SQLite access via Node's built-in `node:sqlite`.
 *
 * Chosen over better-sqlite3 to avoid a node-gyp build step: the constitution
 * requires native module prerequisites to be documented, and the cheapest way
 * to satisfy that is to have none. At this scale — single-digit printers,
 * single-digit users, a few thousand job rows — the built-in is ample.
 */
import { DatabaseSync } from 'node:sqlite'
import { backupBeforeMigrations, isFileBackedLocation } from './backup.ts'
import { migrations } from './migrations/index.ts'

export interface Migration {
  id: number
  name: string
  up: string
  /**
   * Optional code step, run inside the same transaction right after `up`.
   *
   * For data moves that SQL alone cannot express — notably ones that must
   * report what they discarded. Kept optional so the common case stays a
   * plain string.
   */
  apply?: (db: Database, log: (event: Record<string, unknown>) => void) => void
}

export type Database = DatabaseSync

export interface OpenDatabaseOptions {
  /** File path, or ':memory:' for tests. */
  location: string
  /** Notified with the backup path when one is taken, so it can be logged. */
  onBackup?: (path: string | null) => void
}

/**
 * Open a database and bring it up to the latest schema.
 * Migrations are recorded so re-running is a no-op.
 */
export function openDatabase(options: OpenDatabaseOptions): Database {
  const db = new DatabaseSync(options.location)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')

  // Copy the file aside first: individual migrations are atomic, but a
  // half-applied *sequence* leaves the schema somewhere the code does not
  // expect, and that is not something a user can recover from unaided.
  if (isFileBackedLocation(options.location)) {
    const pending = pendingMigrationIds(db)
    if (pending.length > 0) {
      const result = backupBeforeMigrations(options.location, String(pending[0]), true)
      options.onBackup?.(result.path)
    }
  }

  runMigrations(db)
  return db
}

/** Migration ids not yet recorded as applied, in ascending order. */
export function pendingMigrationIds(db: Database, list: Migration[] = migrations): number[] {
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
  return list
    .map((migration) => migration.id)
    .filter((id) => !applied.has(id))
    .sort((a, b) => a - b)
}

/**
 * Structured events emitted by data migrations.
 *
 * Constitution Principle V: a migration that drops data must say so somewhere
 * a person can find it afterwards.
 */
export type MigrationEventSink = (event: Record<string, unknown>) => void

let onMigrationEvent: MigrationEventSink | undefined

export function setMigrationEventSink(sink: MigrationEventSink | undefined): void {
  onMigrationEvent = sink
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
      migration.apply?.(db, onMigrationEvent ?? (() => undefined))
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
