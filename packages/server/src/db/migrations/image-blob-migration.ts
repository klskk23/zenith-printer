/**
 * Move uploaded images out of the uploads directory and into their rows.
 *
 * Every problem the split arrangement had was a problem of keeping two things
 * in step: a path that meant nothing on another machine (fixed in 14), files
 * with no row and rows with no file (a sweep had to look for both), and a
 * backup that was only complete if somebody remembered the second directory.
 * One store and none of those are askable any more.
 *
 * The files are **not deleted**. Deciding that somebody's uploads directory can
 * go is not a migration's call — it is one `rm -rf` after they have seen the
 * pictures still working.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database, MigrationContext } from '../index.ts'

export function imagesIntoRows(
  db: Database,
  log: (event: Record<string, unknown>) => void,
  context: MigrationContext,
): void {
  const rows = db.prepare('SELECT id, storage_path FROM images').all() as Array<{
    id: string
    storage_path: string
  }>
  if (rows.length === 0) {
    // Still drop the column: a fresh database must end up with the same shape
    // as a migrated one, or every query has to cope with both.
    db.exec('ALTER TABLE images DROP COLUMN storage_path;')
    return
  }

  const dir = context.imageStorageDir
  const update = db.prepare('UPDATE images SET bytes = ? WHERE id = ?')
  let moved = 0
  const lost: string[] = []

  for (const row of rows) {
    // After migration 14 the column holds a filename; before it, an absolute
    // path. `join` on an absolute second argument would produce nonsense, so
    // the absolute case is used as it stands.
    const path = row.storage_path.startsWith('/')
      ? row.storage_path
      : dir === undefined
        ? undefined
        : join(dir, row.storage_path)

    let bytes: Buffer | undefined
    if (path !== undefined) {
      try {
        bytes = readFileSync(path)
      } catch {
        bytes = undefined
      }
    }

    if (bytes === undefined) {
      // The row survives with no bytes. It may still be named by a job's
      // snapshot, and dropping it would turn "this picture is missing" into
      // "this label never had a picture" — which is a different and worse lie.
      lost.push(row.id)
      continue
    }
    update.run(bytes, row.id)
    moved += 1
  }

  db.exec('ALTER TABLE images DROP COLUMN storage_path;')

  log({
    event: 'images_moved_into_rows',
    moved,
    // Named, not counted: whoever reads this needs to know which pictures to
    // go looking for, and a number tells them only that they should worry.
    missing: lost,
    imageStorageDir: dir ?? null,
  })
}
