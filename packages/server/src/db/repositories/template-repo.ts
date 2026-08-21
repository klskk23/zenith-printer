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
import type { VariableField } from '../../domain/variable-field.ts'
import type { LabelElement } from '@zenith/shared'

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

  #fields(templateId: string): VariableField[] {
    return this.#db
      .prepare('SELECT * FROM variable_fields WHERE template_id = ? ORDER BY name')
      .all(templateId)
      .map((row) => {
        const r = row as Row
        const field: VariableField = {
          name: String(r.name),
          label: String(r.label),
          source: String(r.source) as VariableField['source'],
        }
        if (r.sample_value !== null) field.sampleValue = String(r.sample_value)
        if (r.seq_start !== null) field.seqStart = Number(r.seq_start)
        if (r.seq_digits !== null) field.seqDigits = Number(r.seq_digits)
        if (r.seq_step !== null) field.seqStep = Number(r.seq_step)
        return field
      })
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
      variableFields: this.#fields(String(row.id)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      version: Number(row.version),
    }
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

  #writeFields(templateId: string, fields: VariableField[]): void {
    this.#db.prepare('DELETE FROM variable_fields WHERE template_id = ?').run(templateId)
    const insert = this.#db.prepare(
      `INSERT INTO variable_fields (template_id, name, label, source, sample_value, seq_start, seq_digits, seq_step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const field of fields) {
      insert.run(
        templateId,
        field.name,
        field.label,
        field.source,
        field.sampleValue ?? null,
        field.seqStart ?? null,
        field.seqDigits ?? null,
        field.seqStep ?? null,
      )
    }
  }

  create(input: TemplateInput): Template {
    const id = this.#ids.next()
    const now = this.#clock.now().toISOString()

    this.#db.exec('BEGIN')
    try {
      this.#db
        .prepare(
          `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(id, input.name, input.printerKind, input.widthMm, input.heightMm, input.dpi, JSON.stringify(input.elements), now, now)
      this.#writeFields(id, input.variableFields)
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
          `UPDATE templates SET name = ?, printer_kind = ?, width_mm = ?, height_mm = ?, dpi = ?, elements = ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        )
        .run(input.name, input.printerKind, input.widthMm, input.heightMm, input.dpi, JSON.stringify(input.elements), now, id)
      this.#writeFields(id, input.variableFields)
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
   * Templates delete freely: job history carries its own snapshot, so nothing
   * downstream breaks (FR-050, FR-051).
   */
  delete(id: string): void {
    this.#db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  }
}
