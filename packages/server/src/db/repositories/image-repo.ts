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
 * The bytes live in the row (migration 15). They used to be files on disk with
 * a path in the row, and every difficulty that caused was the same difficulty:
 * keeping two things in step. A path meant nothing on another machine; files
 * turned up with no row and rows with no file, so a sweep had to look for both;
 * and a backup was complete only if somebody remembered the second directory.
 * One store, and none of that is askable.
 *
 * The cost, which the original split was avoiding, is that a multi-megabyte
 * logo now rides along on any query that says `SELECT *`. So nothing here does:
 * every read names its columns, and the bytes are fetched only by the one
 * method whose job that is.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import { collectAssetIds } from '../../domain/image-references.ts'

export interface ImageAsset {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  deletedAt: string | null
  createdAt: string
}

type Row = Record<string, unknown>

/** Everything except the bytes — see the class comment for why that matters. */
const COLUMNS = 'id, filename, mime_type, size_bytes, deleted_at, created_at'

function toAsset(row: Row): ImageAsset {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    createdAt: String(row.created_at),
  }
}

export interface ImageRepoDeps {
  db: Database
  clock: Clock
  ids: IdGenerator
}

export class ImageRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: ImageRepoDeps) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  /** Live assets only; soft-deleted ones stay resolvable but are not listed. */
  list(): ImageAsset[] {
    return this.#db
      .prepare(`SELECT ${COLUMNS} FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC`)
      .all()
      .map((row) => toAsset(row as Row))
  }

  /** Includes soft-deleted assets, so history can still render (FR-051). */
  find(id: string): ImageAsset | undefined {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM images WHERE id = ?`).get(id)
    return row === undefined ? undefined : toAsset(row as Row)
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
        `INSERT INTO images (id, filename, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.filename, input.mimeType, input.sizeBytes, this.#clock.now().toISOString())
    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`image ${id} vanished immediately after insert`)
    }
    return created
  }

  /**
   * Store the picture itself.
   *
   * Separate from `create` because the id is minted by the insert and nothing
   * before it knows what to call the row. Two statements rather than one large
   * insert also keeps the bytes out of the path that reports a duplicate name.
   */
  attachBytes(id: string, bytes: Uint8Array): void {
    this.#db.prepare('UPDATE images SET bytes = ? WHERE id = ?').run(bytes, id)
  }

  /**
   * The picture, or undefined when the row has none.
   *
   * `undefined` is a real state: migration 15 keeps rows whose file had already
   * gone, because dropping them would turn "this picture is missing" into "this
   * label never had one".
   */
  bytes(id: string): Buffer | undefined {
    const row = this.#db.prepare('SELECT bytes FROM images WHERE id = ?').get(id) as
      | { bytes: Uint8Array | null }
      | undefined
    // Null when the row carries no picture, undefined when there is no row.
    // Both mean the same thing to every caller: nothing to draw.
    const bytes = row?.bytes
    return bytes === null || bytes === undefined ? undefined : Buffer.from(bytes)
  }

  /** Every asset, including the marked ones — what a sweep has to consider. */
  all(): ImageAsset[] {
    return this.#db
      .prepare(`SELECT ${COLUMNS} FROM images ORDER BY created_at`)
      .all()
      .map((row) => toAsset(row as Row))
  }

  /**
   * A lookup for the renderer: mime type and bytes, in one statement.
   *
   * Separate from `find` so the light read stays light. The renderer is the
   * only caller that wants the picture itself, and it caches — a job renders
   * once per copy, and re-reading a logo a hundred times would be pure waste.
   */
  lookup(): { find(assetId: string): { mimeType: string; bytes: Uint8Array } | undefined } {
    const statement = this.#db.prepare('SELECT mime_type, bytes FROM images WHERE id = ?')
    return {
      find: (assetId) => {
        const row = statement.get(assetId) as
          | { mime_type: string; bytes: Uint8Array | null }
          | undefined
        const bytes = row?.bytes
        return bytes === null || bytes === undefined
          ? undefined
          : { mimeType: String(row!.mime_type), bytes }
      },
    }
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
