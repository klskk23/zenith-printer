/**
 * Image asset persistence.
 *
 * The only entity that is soft-deleted. A job snapshot can duplicate text and
 * numbers, but it cannot duplicate a binary, so deleting an image that history
 * still references would break the record of what was printed (FR-051).
 * Whether anything references it decides: unreferenced images go for real,
 * referenced ones are marked and kept.
 *
 * That question used to be answered by a `ref_count` column. Nothing ever
 * incremented it, so it read zero for every row and `delete` removed files that
 * history still needed. It is gone (migration 13); the answer now comes from
 * reading the designs, which cannot drift out of step with them.
 *
 * `storage_path` holds a **filename**, and the directory comes from the
 * deployment. It used to hold the absolute path the file had when it was
 * uploaded, which made the database unmovable: copy the data directory to
 * another server — or into the container, where uploads always live at
 * /data/uploads — and every row pointed somewhere that did not exist. The
 * templates were intact, the ids still matched, and not one picture rendered.
 * Where the files live is a property of the machine, and a machine cannot be
 * recorded inside a file that gets copied off it (migration 14).
 */
import { basename, join } from 'node:path'
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import { collectAssetIds } from '../../domain/image-references.ts'

export interface ImageAsset {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  deletedAt: string | null
  createdAt: string
}

type Row = Record<string, unknown>

function toAsset(row: Row, resolve: (stored: string) => string): ImageAsset {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    // Absolute, because everything downstream reads a file. What the column
    // holds is a filename; see the class comment.
    storagePath: resolve(String(row.storage_path)),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
  }
}

export interface ImageRepoDeps {
  db: Database
  clock: Clock
  ids: IdGenerator
  /** Where this deployment keeps uploaded files. */
  storageDir: string
}

export class ImageRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #storageDir: string

  constructor(deps: ImageRepoDeps) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
    this.#storageDir = deps.storageDir
  }

  /**
   * Stored filename to a path on this machine.
   *
   * `basename` rather than a straight join: a database restored from a backup
   * taken before migration 14 still holds somebody else's absolute path, and
   * joining that onto the storage directory would produce nonsense. Only the
   * last segment was ever the file.
   */
  #resolve(stored: string): string {
    return join(this.#storageDir, basename(stored))
  }

  /** Live assets only; soft-deleted ones stay resolvable but are not listed. */
  list(): ImageAsset[] {
    return this.#db
      .prepare('SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC')
      .all()
      .map((row) => toAsset(row as Row, (p) => this.#resolve(p)))
  }

  /** Includes soft-deleted assets, so history can still render (FR-051). */
  find(id: string): ImageAsset | undefined {
    const row = this.#db.prepare('SELECT * FROM images WHERE id = ?').get(id)
    return row === undefined ? undefined : toAsset(row as Row, (p) => this.#resolve(p))
  }

  /**
   * Record the metadata. The file is attached afterwards, by `attachFile`.
   *
   * Two steps because the id names the file: the row has to exist before there
   * is a name to write the bytes under. An orphan row is easier to reason about
   * than an orphan file — and the sweep collects both.
   */
  create(input: { filename: string; mimeType: string; sizeBytes: number }): ImageAsset {
    const id = this.#ids.next()
    this.#db
      .prepare(
        `INSERT INTO images (id, filename, mime_type, size_bytes, storage_path, created_at)
         VALUES (?, ?, ?, ?, '', ?)`,
      )
      .run(id, input.filename, input.mimeType, input.sizeBytes, this.#clock.now().toISOString())
    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`image ${id} vanished immediately after insert`)
    }
    return created
  }

  /**
   * Name the file this asset's bytes were written to.
   *
   * Takes a filename, never a path. The SQL lives here rather than at the two
   * upload sites so that the one rule about this column — it holds a name, not
   * a location — has one place to be broken and one place to be checked.
   */
  attachFile(id: string, fileName: string): void {
    this.#db.prepare('UPDATE images SET storage_path = ? WHERE id = ?').run(basename(fileName), id)
  }

  /** Every asset, including the marked ones — what a sweep has to consider. */
  all(): ImageAsset[] {
    return this.#db
      .prepare('SELECT * FROM images ORDER BY created_at')
      .all()
      .map((row) => toAsset(row as Row, (p) => this.#resolve(p)))
  }

  /**
   * Every asset id some stored design still names.
   *
   * Read from the designs themselves rather than tracked as they change: the
   * two tables below are the only places an `assetId` can live, and asking them
   * cannot fall out of step with them. Throws when a row cannot be parsed —
   * see `collectAssetIds` for why refusing beats guessing.
   */
  referencedAssetIds(): Set<string> {
    const documents = [
      ...this.#db.prepare('SELECT elements FROM templates').all().map((row) => String((row as Row).elements)),
      ...this.#db.prepare('SELECT snapshot FROM print_jobs').all().map((row) => String((row as Row).snapshot)),
    ]
    return collectAssetIds(documents)
  }

  /** Drop the row outright. The caller unlinks the file. */
  hardDelete(id: string): void {
    this.#db.prepare('DELETE FROM images WHERE id = ?').run(id)
  }

  /**
   * Remove an asset. Returns whether the file on disk may also be removed:
   * false means history still points at it and the row was only marked.
   */
  delete(id: string): { removedFromDisk: boolean } {
    const asset = this.find(id)
    if (asset === undefined) {
      return { removedFromDisk: false }
    }

    if (this.referencedAssetIds().has(id)) {
      this.#db
        .prepare('UPDATE images SET deleted_at = ? WHERE id = ?')
        .run(this.#clock.now().toISOString(), id)
      return { removedFromDisk: false }
    }

    this.#db.prepare('DELETE FROM images WHERE id = ?').run(id)
    return { removedFromDisk: true }
  }
}
