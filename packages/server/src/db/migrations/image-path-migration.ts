/**
 * Make the image rows portable.
 *
 * `storage_path` held the absolute path a file had when it was uploaded —
 * `/home/someone/zenith-printer/data/uploads/<id>.png`. Copy the data directory
 * to another server, or into the container where uploads always live at
 * /data/uploads, and every row pointed somewhere that did not exist: templates
 * intact, ids still matching, and not one picture rendering.
 *
 * The directory is a property of the machine and belongs to the deployment;
 * only the filename belongs in the row. Done in JS rather than SQL because
 * SQLite has no basename, and doing it with nested `replace()` calls would be a
 * puzzle rather than a migration.
 */
import type { Database } from '../index.ts'

/** The last segment, for both separators — a Windows-authored row is possible. */
function fileNameOf(stored: string): string {
  const cut = Math.max(stored.lastIndexOf('/'), stored.lastIndexOf('\\'))
  return cut === -1 ? stored : stored.slice(cut + 1)
}

export function relativiseImagePaths(db: Database): void {
  const rows = db.prepare('SELECT id, storage_path FROM images').all() as Array<{
    id: string
    storage_path: string
  }>
  const update = db.prepare('UPDATE images SET storage_path = ? WHERE id = ?')
  for (const row of rows) {
    const name = fileNameOf(row.storage_path)
    if (name !== row.storage_path) {
      update.run(name, row.id)
    }
  }
}
