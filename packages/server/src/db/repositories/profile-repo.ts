/** Print profile persistence. */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import type { Profile, ProfileInput } from '../../domain/profile.ts'

type Row = Record<string, unknown>

function toProfile(row: Row): Profile {
  const profile: Profile = {
    id: String(row.id),
    printerId: String(row.printer_id),
    name: String(row.name),
    density: Number(row.density),
    labelType: Number(row.label_type),
    labelWidthMm: Number(row.label_width_mm),
    labelHeightMm: Number(row.label_height_mm),
    marginTopMm: Number(row.margin_top_mm ?? 0),
    marginRightMm: Number(row.margin_right_mm ?? 0),
    marginBottomMm: Number(row.margin_bottom_mm ?? 0),
    marginLeftMm: Number(row.margin_left_mm ?? 0),
    isDefault: Number(row.is_default) === 1,
    createdAt: String(row.created_at),
  }
  if (row.speed !== null) {
    profile.speed = Number(row.speed)
  }
  return profile
}

export class ProfileRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: { db: Database; clock: Clock; ids: IdGenerator }) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  listFor(printerId: string): Profile[] {
    return this.#db
      .prepare('SELECT * FROM profiles WHERE printer_id = ? ORDER BY created_at')
      .all(printerId)
      .map((row) => toProfile(row as Row))
  }

  find(id: string): Profile | undefined {
    const row = this.#db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
    return row === undefined ? undefined : toProfile(row as Row)
  }

  defaultFor(printerId: string): Profile | undefined {
    const row = this.#db
      .prepare('SELECT * FROM profiles WHERE printer_id = ? AND is_default = 1')
      .get(printerId)
    return row === undefined ? undefined : toProfile(row as Row)
  }

  #clearDefault(printerId: string): void {
    this.#db.prepare('UPDATE profiles SET is_default = 0 WHERE printer_id = ?').run(printerId)
  }

  create(printerId: string, input: ProfileInput): Profile {
    const id = this.#ids.next()
    if (input.isDefault) {
      this.#clearDefault(printerId)
    }
    this.#db
      .prepare(
        `INSERT INTO profiles (id, printer_id, name, density, label_type, speed,
                               label_width_mm, label_height_mm,
                               margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm,
                               is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        printerId,
        input.name,
        input.density,
        input.labelType,
        input.speed ?? null,
        input.labelWidthMm,
        input.labelHeightMm,
        input.marginTopMm,
        input.marginRightMm,
        input.marginBottomMm,
        input.marginLeftMm,
        input.isDefault ? 1 : 0,
        this.#clock.now().toISOString(),
      )
    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`profile ${id} vanished immediately after insert`)
    }
    return created
  }

  update(id: string, input: ProfileInput): Profile | undefined {
    const existing = this.find(id)
    if (existing === undefined) {
      return undefined
    }
    if (input.isDefault) {
      this.#clearDefault(existing.printerId)
    }
    this.#db
      .prepare(
        `UPDATE profiles SET name = ?, density = ?, label_type = ?, speed = ?,
                             label_width_mm = ?, label_height_mm = ?,
                             margin_top_mm = ?, margin_right_mm = ?, margin_bottom_mm = ?, margin_left_mm = ?,
                             is_default = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.density,
        input.labelType,
        input.speed ?? null,
        input.labelWidthMm,
        input.labelHeightMm,
        input.marginTopMm,
        input.marginRightMm,
        input.marginBottomMm,
        input.marginLeftMm,
        input.isDefault ? 1 : 0,
        id,
      )
    return this.find(id)
  }

  delete(id: string): void {
    this.#db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }
}
