/**
 * Move each printer's position correction off its profiles and onto itself.
 *
 * The value comes from the printer's default profile. Where other profiles of
 * the same printer carried a *different* offset, those values are dropped —
 * there is no way to keep them, since the destination holds one offset per
 * machine. Dropping data quietly is not acceptable, so each discarded value is
 * reported with enough context to re-enter it by hand: which printer, which
 * profile, and what the numbers were.
 *
 * Millimetres become dots here. Rounding is what the renderer would have done
 * anyway; doing it once, now, means the stored value is exactly what gets
 * applied.
 */
import type { Database, MigrationEventSink } from '../index.ts'

const MM_PER_INCH = 25.4
/** Every printer this project supports is 203 dpi; used only if none is known. */
const FALLBACK_DPI = 203

interface ProfileRow {
  id: string
  printer_id: string
  name: string
  offset_x_mm: number
  offset_y_mm: number
  is_default: number
}

function toDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / MM_PER_INCH)
}

export function migrateOffsets(db: Database, log: MigrationEventSink): void {
  const profiles = db
    .prepare('SELECT id, printer_id, name, offset_x_mm, offset_y_mm, is_default FROM profiles')
    .all() as unknown as ProfileRow[]

  if (profiles.length === 0) {
    return
  }

  const byPrinter = new Map<string, ProfileRow[]>()
  for (const profile of profiles) {
    const list = byPrinter.get(profile.printer_id) ?? []
    list.push(profile)
    byPrinter.set(profile.printer_id, list)
  }

  const printerName = db.prepare('SELECT name, dpi FROM printers WHERE id = ?')
  const update = db.prepare('UPDATE printers SET offset_x_dots = ?, offset_y_dots = ? WHERE id = ?')

  for (const [printerId, list] of byPrinter) {
    const row = printerName.get(printerId) as { name?: unknown; dpi?: unknown } | undefined
    const dpi = typeof row?.dpi === 'number' && row.dpi > 0 ? row.dpi : FALLBACK_DPI

    // The default profile is the one whose settings were in force, so its
    // offset is the one that describes where this machine actually prints.
    const chosen = list.find((profile) => profile.is_default === 1) ?? list[0]
    if (chosen === undefined) {
      continue
    }

    update.run(toDots(chosen.offset_x_mm, dpi), toDots(chosen.offset_y_mm, dpi), printerId)

    for (const profile of list) {
      const differs =
        profile.id !== chosen.id &&
        (profile.offset_x_mm !== chosen.offset_x_mm || profile.offset_y_mm !== chosen.offset_y_mm)
      if (!differs) {
        continue
      }
      log({
        event: 'migration.offset_discarded',
        migration: 'printer_offset_and_stock',
        printerId,
        printerName: typeof row?.name === 'string' ? row.name : null,
        profileId: profile.id,
        profileName: profile.name,
        discardedOffsetXMm: profile.offset_x_mm,
        discardedOffsetYMm: profile.offset_y_mm,
        keptFromProfile: chosen.name,
        // Said plainly, because whoever reads this log is the person who has to
        // recalibrate that roll.
        message:
          'Offset moved to the printer; this profile carried a different value which could not be kept.',
      })
    }
  }
}
