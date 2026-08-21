/**
 * Pre-migration backup.
 *
 * Migrations are individually atomic, but a *sequence* of them is not: if the
 * third of four fails, the schema is left somewhere the code no longer expects.
 * The 002 feature moves printer offsets between tables, which is exactly the
 * kind of change worth being able to walk back from.
 *
 * A file copy is enough here. The database is single-digit megabytes and the
 * service is single-process, so there is no concurrent writer to race with.
 */
import { copyFileSync, existsSync } from 'node:fs'

/** In-memory databases have no file to copy, and tests use them throughout. */
export function isFileBackedLocation(location: string): boolean {
  return location !== ':memory:' && !location.startsWith('file::memory:')
}

export interface BackupResult {
  /** Absolute or relative path written, or null when no backup was needed. */
  path: string | null
  reason: 'created' | 'not-file-backed' | 'no-existing-file' | 'up-to-date'
}

/**
 * Copy the database aside before pending migrations run.
 *
 * `suffix` is supplied by the caller rather than derived from the clock: a
 * timestamp read here would make the function untestable, and the migration id
 * is a more useful name anyway ("what was this the state before?").
 */
export function backupBeforeMigrations(
  location: string,
  suffix: string,
  hasPendingMigrations: boolean,
): BackupResult {
  if (!isFileBackedLocation(location)) {
    return { path: null, reason: 'not-file-backed' }
  }
  if (!existsSync(location)) {
    // A database that does not exist yet has nothing worth preserving.
    return { path: null, reason: 'no-existing-file' }
  }
  if (!hasPendingMigrations) {
    return { path: null, reason: 'up-to-date' }
  }

  const path = `${location}.before-${suffix}.bak`
  copyFileSync(location, path)
  return { path, reason: 'created' }
}
