/**
 * Template persistence.
 *
 * Saves overwrite (no version history, per the spec's assumptions), but a save
 * carries the `version` it was loaded with. A stale token means somebody
 * else saved in between, and the caller is told rather than having their work
 * silently replaced.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import { TemplateConflictError, type Template, type TemplateInput } from '../../domain/template.ts'
import { variableDefinitionsSchema, type LabelElement, type VariableDefinition } from '@zenith/shared'

type Row = Record<string, unknown>

export class TemplateRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: { db: Database; clock: Clock; ids: IdGenerator }) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  /**
   * Variable definitions live in a JSON column rather than their own table.
   *
   * They are a property of the design, always read and written whole, and
   * never queried across templates — a table would buy joins nobody performs.
   * Parsed through the schema so a hand-edited database cannot put a shape the
   * renderer does not understand in front of the editor.
   */
  #variables(raw: unknown): VariableDefinition[] {
    const parsed = variableDefinitionsSchema.safeParse(JSON.parse(String(raw ?? '[]')))
    return parsed.success ? parsed.data : []
  }

  #toTemplate(row: Row): Template {
    return {
      id: String(row.id),
      name: String(row.name),
      printerKind: String(row.printer_kind) as Template['printerKind'],
      widthMm: Number(row.width_mm),
      heightMm: Number(row.height_mm),
      dpi: Number(row.dpi),
      elements: JSON.parse(String(row.elements)) as LabelElement[],
      variables: this.#variables(row.variables),
      dataSourceId: row.data_source_id === null || row.data_source_id === undefined ? null : String(row.data_source_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      version: Number(row.version),
      hasThumbnail: row.thumbnail !== null && row.thumbnail !== undefined,
    }
  }

  /**
   * Store the library picture, or clear it.
   *
   * Separate from `create`/`update` so a failure to draw cannot fail a save:
   * the design is written first, and the picture is attached afterwards.
   * Deliberately does **not** touch `version` — the thumbnail is derived from
   * the design, so it never means somebody else's edit was overwritten.
   */
  saveThumbnail(id: string, png: Uint8Array | null): void {
    this.#db.prepare('UPDATE templates SET thumbnail = ? WHERE id = ?').run(png, id)
  }

  /** The stored PNG, or undefined when there is none (or no such template). */
  thumbnail(id: string): Uint8Array | undefined {
    const row = this.#db.prepare('SELECT thumbnail FROM templates WHERE id = ?').get(id) as
      | { thumbnail: Uint8Array | null }
      | undefined
    return row?.thumbnail === null || row?.thumbnail === undefined ? undefined : row.thumbnail
  }

  list(): Template[] {
    return this.#db
      .prepare('SELECT * FROM templates ORDER BY updated_at DESC')
      .all()
      .map((row) => this.#toTemplate(row as Row))
  }

  find(id: string): Template | undefined {
    const row = this.#db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
    return row === undefined ? undefined : this.#toTemplate(row as Row)
  }

  create(input: TemplateInput): Template {
    const id = this.#ids.next()
    const now = this.#clock.now().toISOString()

    this.#db.exec('BEGIN')
    try {
      this.#db
        .prepare(
          `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, variables, data_source_id, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          id, input.name, input.printerKind, input.widthMm, input.heightMm, input.dpi,
          JSON.stringify(input.elements), JSON.stringify(input.variables), input.dataSourceId, now, now,
        )
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }

    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`template ${id} vanished immediately after insert`)
    }
    return created
  }

  /**
   * `expectedVersion` is the token the caller loaded with.
   *
   * This used to compare `updatedAt`. Two saves inside the same clock tick
   * produced equal timestamps, so the second was accepted and overwrote the
   * first without anybody being told — which is the whole thing this check is
   * supposed to make impossible.
   */
  update(id: string, input: TemplateInput, expectedVersion: number): Template {
    const current = this.find(id)
    if (current === undefined) {
      throw new Error(`template ${id} does not exist`)
    }
    if (current.version !== expectedVersion) {
      // Last write wins is fine; last write wins *silently* is not.
      throw new TemplateConflictError(id, current.version)
    }

    const now = this.#clock.now().toISOString()
    this.#db.exec('BEGIN')
    try {
      this.#db
        .prepare(
          `UPDATE templates SET name = ?, printer_kind = ?, width_mm = ?, height_mm = ?, dpi = ?, elements = ?,
             variables = ?, data_source_id = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(
          input.name, input.printerKind, input.widthMm, input.heightMm, input.dpi,
          JSON.stringify(input.elements), JSON.stringify(input.variables), input.dataSourceId, now, id,
        )
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }

    const updated = this.find(id)
    if (updated === undefined) {
      throw new Error(`template ${id} vanished during update`)
    }
    return updated
  }

  /**
   * Rename only.
   *
   * Bumps the version like any other write, which matters: a design tab open on
   * this template still holds the old name, and saving it would put that name
   * back without anybody being told. The bump turns that into the conflict
   * prompt the editor already knows how to show.
   *
   * Unlike a data source, the name is not a reference — nothing points at a
   * template by name — so a rename cannot break anything downstream.
   */
  rename(id: string, name: string): Template | undefined {
    if (this.find(id) === undefined) {
      return undefined
    }
    this.#db
      .prepare('UPDATE templates SET name = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(name, this.#clock.now().toISOString(), id)
    return this.find(id)
  }

  /**
   * Templates delete freely: job history carries its own snapshot, so nothing
   * downstream breaks (FR-050, FR-051).
   */
  delete(id: string): void {
    this.#db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  }
}
