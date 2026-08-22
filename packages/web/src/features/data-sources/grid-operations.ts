/**
 * The grid's row shape, and the column type that keeps values intact.
 *
 * This file used to also translate the grid's per-change description — its
 * `UPDATE` / `CREATE` / `DELETE` ranges — into a patch, because every edit went
 * straight to the server. Now that edits are staged and sent on Save, the patch
 * is a diff of two whole tables (`table-history.ts`), and the change
 * description is not needed: the grid's new value is the whole answer.
 */
import { createTextColumn } from 'react-datasheet-grid'
import type { DataSourceRow } from './hooks.ts'

export interface RowPatch {
  upserts: Array<{ ordinal: number; values: Record<string, string> }>
  deletes: number[]
}

/**
 * The grid's row shape: one flat record of strings.
 *
 * The ordinal is carried by the array position rather than as a field, which is
 * what lets a paste append rows without inventing numbers for them.
 */
export type GridRow = Record<string, string>

/** Server rows to grid rows. The ordinal is carried in the array position. */
export function toGridRows(rows: readonly DataSourceRow[], columns: readonly string[]): GridRow[] {
  return rows.map((row) => {
    const flat: GridRow = {}
    for (const column of columns) {
      flat[column] = row.values[column] ?? ''
    }
    return flat
  })
}

/** A blank row, with every column present so an edit patches rather than adds. */
export function emptyGridRow(columns: readonly string[]): GridRow {
  const row: GridRow = {}
  for (const column of columns) {
    row[column] = ''
  }
  return row
}

/**
 * A column that keeps every value a string, exactly as typed or pasted.
 *
 * The grid's stock text column yields `null` for an empty cell and would let a
 * parser in. Neither is acceptable here for the same reason the CSV importer
 * refuses type inference: `007` becoming `7`, or an empty cell becoming absent,
 * is data loss discovered on a printed label (FR-024).
 *
 * `deletedValue` is the empty string rather than null so pressing Delete
 * *clears* a cell instead of removing the column from that row.
 */
export const stringColumn = createTextColumn<string>({
  continuousUpdates: false,
  deletedValue: '',
  parseUserInput: (value) => value,
  parsePastedValue: (value) => value,
  formatBlurredInput: (value) => value,
})
