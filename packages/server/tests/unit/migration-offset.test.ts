/**
 * Moving position correction from the profile onto the printer.
 *
 * A machine has one place where it lays ink down, so it gets one offset.
 * Profiles that disagreed cannot all be kept — but dropping their values
 * quietly would leave someone recalibrating a roll with no idea why it moved.
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations, type Migration } from '../../src/db/index.ts'
import { migrations } from '../../src/db/migrations/index.ts'
import { migrateOffsets } from '../../src/db/migrations/offset-migration.ts'

/** Everything up to but not including the offset move. */
function seedOldSchema(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(
    db,
    migrations.filter((m): m is Migration => m.id <= 2),
  )
  // Migration 3's columns, without its data step.
  db.exec(`
    ALTER TABLE printers ADD COLUMN offset_x_dots INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE printers ADD COLUMN offset_y_dots INTEGER NOT NULL DEFAULT 0;
  `)
  return db
}

function addPrinter(db: DatabaseSync, id: string, name: string, dpi = 203): void {
  db.prepare(
    `INSERT INTO printers (id, name, kind, transport, address, dpi, queue_state, created_at)
     VALUES (?, ?, 'niimbot', 'serial', '/dev/ttyACM0', ?, 'running', '2026-01-01T00:00:00.000Z')`,
  ).run(id, name, dpi)
}

function addProfile(
  db: DatabaseSync,
  spec: { id: string; printerId: string; name: string; x: number; y: number; isDefault: boolean },
): void {
  db.prepare(
    `INSERT INTO profiles (id, printer_id, name, density, label_type, offset_x_mm, offset_y_mm, is_default, created_at)
     VALUES (?, ?, ?, 3, 1, ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  ).run(spec.id, spec.printerId, spec.name, spec.x, spec.y, spec.isDefault ? 1 : 0)
}

function offsetOf(db: DatabaseSync, printerId: string): { x: number; y: number } {
  const row = db.prepare('SELECT offset_x_dots, offset_y_dots FROM printers WHERE id = ?').get(printerId) as
    | { offset_x_dots: number; offset_y_dots: number }
    | undefined
  return { x: Number(row?.offset_x_dots ?? 0), y: Number(row?.offset_y_dots ?? 0) }
}

describe('migrateOffsets', () => {
  it('carries the default profile offset onto the printer', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'B3S_P')
    // 0.5mm at 203 dpi is 4 dots.
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'stock', x: 0.5, y: -0.25, isDefault: true })

    migrateOffsets(db, () => undefined)

    expect(offsetOf(db, 'p1')).toEqual({ x: 4, y: -2 })
  })

  it('uses the printer dpi rather than assuming one', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'other', 300)
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'stock', x: 1, y: 0, isDefault: true })

    migrateOffsets(db, () => undefined)

    // 1mm at 300 dpi is ~12 dots, not the 8 it would be at 203.
    expect(offsetOf(db, 'p1').x).toBe(12)
  })

  it('falls back to the only profile when none is marked default', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'B3S_P')
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'only', x: 0.25, y: 0, isDefault: false })

    migrateOffsets(db, () => undefined)

    expect(offsetOf(db, 'p1').x).toBe(2)
  })

  it('keeps printers apart', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'first')
    addPrinter(db, 'p2', 'second')
    addProfile(db, { id: 'a', printerId: 'p1', name: 'a', x: 0.5, y: 0, isDefault: true })
    addProfile(db, { id: 'b', printerId: 'p2', name: 'b', x: -0.5, y: 0, isDefault: true })

    migrateOffsets(db, () => undefined)

    expect(offsetOf(db, 'p1').x).toBe(4)
    expect(offsetOf(db, 'p2').x).toBe(-4)
  })

  it('leaves a printer with no profiles at zero', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'fresh')

    migrateOffsets(db, () => undefined)

    expect(offsetOf(db, 'p1')).toEqual({ x: 0, y: 0 })
  })
})

/**
 * FR-077. The person who reads this log is the one who has to recalibrate that
 * roll, so the record has to name the printer, the profile and the numbers.
 */
describe('reporting discarded values', () => {
  function withConflictingProfiles(): { db: DatabaseSync; events: Record<string, unknown>[] } {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'B3S_P')
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'original stock', x: 0.5, y: 0, isDefault: true })
    addProfile(db, { id: 'pr2', printerId: 'p1', name: 'third-party stock', x: 1.25, y: -0.5, isDefault: false })

    const events: Record<string, unknown>[] = []
    migrateOffsets(db, (event) => events.push(event))
    return { db, events }
  }

  it('keeps the default profile value', () => {
    const { db } = withConflictingProfiles()
    expect(offsetOf(db, 'p1').x).toBe(4)
  })

  it('reports each value it could not keep', () => {
    const { events } = withConflictingProfiles()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'migration.offset_discarded',
      printerId: 'p1',
      printerName: 'B3S_P',
      profileName: 'third-party stock',
      discardedOffsetXMm: 1.25,
      discardedOffsetYMm: -0.5,
    })
  })

  it('says nothing when the profiles agreed', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'B3S_P')
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'a', x: 0.5, y: 0, isDefault: true })
    addProfile(db, { id: 'pr2', printerId: 'p1', name: 'b', x: 0.5, y: 0, isDefault: false })

    const events: Record<string, unknown>[] = []
    migrateOffsets(db, (event) => events.push(event))

    expect(events).toEqual([])
  })
})

describe('the full migration chain', () => {
  it('ends with the offset on the printer and gone from the profile', () => {
    const db = seedOldSchema()
    addPrinter(db, 'p1', 'B3S_P')
    addProfile(db, { id: 'pr1', printerId: 'p1', name: 'stock', x: 0.5, y: 0, isDefault: true })

    // Migration 3 already had its columns added by the seed, so run its data
    // step and migration 4 to confirm the end state.
    migrateOffsets(db, () => undefined)
    db.exec('ALTER TABLE profiles DROP COLUMN offset_x_mm; ALTER TABLE profiles DROP COLUMN offset_y_mm;')

    expect(offsetOf(db, 'p1').x).toBe(4)
    const columns = db.prepare("SELECT name FROM pragma_table_info('profiles')").all().map((r) => String(r.name))
    expect(columns).not.toContain('offset_x_mm')
  })
})
