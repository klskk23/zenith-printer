/**
 * Print preset persistence.
 *
 * Nothing clever: four references and a count. The interesting decisions are
 * in the schema (migration 17) — what each of those references does when the
 * thing it points at is deleted.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import type { PrintPreset, PrintPresetInput, PrintPresetPatch } from '../../domain/print-preset.ts'

type Row = Record<string, unknown>

export class PrintPresetRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: { db: Database; clock: Clock; ids: IdGenerator }) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  #toPreset(row: Row): PrintPreset {
    return {
      id: String(row.id),
      name: String(row.name),
      templateId: String(row.template_id),
      printerId: String(row.printer_id),
      profileId: row.profile_id === null || row.profile_id === undefined ? null : String(row.profile_id),
      copies: Number(row.copies),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  list(): PrintPreset[] {
    return this.#db
      .prepare('SELECT * FROM print_presets ORDER BY name')
      .all()
      .map((row) => this.#toPreset(row as Row))
  }

  find(id: string): PrintPreset | undefined {
    const row = this.#db.prepare('SELECT * FROM print_presets WHERE id = ?').get(id)
    return row === undefined ? undefined : this.#toPreset(row as Row)
  }

  findByName(name: string): PrintPreset | undefined {
    const row = this.#db.prepare('SELECT * FROM print_presets WHERE name = ?').get(name)
    return row === undefined ? undefined : this.#toPreset(row as Row)
  }

  create(input: PrintPresetInput): PrintPreset {
    const id = this.#ids.next()
    const now = this.#clock.now().toISOString()
    this.#db
      .prepare(
        `INSERT INTO print_presets (id, name, template_id, printer_id, profile_id, copies, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.templateId, input.printerId, input.profileId ?? null, input.copies, now, now)
    return this.find(id)!
  }

  update(id: string, patch: PrintPresetPatch): PrintPreset | undefined {
    const current = this.find(id)
    if (current === undefined) {
      return undefined
    }
    this.#db
      .prepare(
        `UPDATE print_presets
            SET name = ?, template_id = ?, printer_id = ?, profile_id = ?, copies = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.templateId ?? current.templateId,
        patch.printerId ?? current.printerId,
        // `profileId: null` is a real instruction — "use the printer's
        // defaults" — so it is distinguished from the field being absent.
        patch.profileId === undefined ? current.profileId : (patch.profileId ?? null),
        patch.copies ?? current.copies,
        this.#clock.now().toISOString(),
        id,
      )
    return this.find(id)
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM print_presets WHERE id = ?').run(id)
  }
}
