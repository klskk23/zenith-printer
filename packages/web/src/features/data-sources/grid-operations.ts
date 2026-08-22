/**
 * Turning the grid's change description into a row patch.
 *
 * react-datasheet-grid hands back the whole new value plus a list of what
 * changed — `UPDATE`, `CREATE`, `DELETE`, each over a half-open range of row
 * indices. The server speaks in *ordinals*: positions in the table, 1-based.
 *
 * The two disagree in one place that matters. A `DELETE` names indices into the
 * table **as it was**, while `UPDATE` and `CREATE` name indices into the table
 * **as it now is**. Reading a delete against the new array takes the wrong rows
 * out — and taking the wrong row out of a label table is not visible until the
 * labels are printed.
 */
import { createTextColumn } from 'react-datasheet-grid'
import type { DataSourceRow } from './hooks.ts'

export interface GridOperation {
  type: 'UPDATE' | 'CREATE' | 'DELETE'
  /** Inclusive. */
  fromRowIndex: number
  /** Exclusive, as the grid defines it. */
  toRowIndex: number
}

export interface RowPatch {
  upserts: Array<{ ordinal: number; values: Record<string, string> }>
  deletes: number[]
}

/**
 * Every value as a string, and every column present.
 *
 * An absent key would leave the old value in place on the server, so clearing
 * a cell would silently do nothing. `undefined` reaches here from a row the
 * grid created before the user typed in it.
 */
function stringValues(row: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [column, value] of Object.entries(row)) {
    values[column] = value === undefined || value === null ? '' : String(value)
  }
  return values
}

/**
 * Build the patch for one change.
 *
 * `rows` is the grid's new value. Deletes are resolved against the old
 * positions, which is what the grid reports and what the server needs.
 */
export function patchFromOperations(
  rows: ReadonlyArray<Record<string, unknown>>,
  operations: readonly GridOperation[],
): RowPatch {
  const deletes: number[] = []
  // Keyed by ordinal so overlapping ranges — a paste reports UPDATE and CREATE
  // over adjacent rows — do not send the same row twice.
  const upserts = new Map<number, Record<string, string>>()

  for (const operation of operations) {
    if (operation.type === 'DELETE') {
      for (let index = operation.fromRowIndex; index < operation.toRowIndex; index += 1) {
        deletes.push(index + 1)
      }
      continue
    }

    for (let index = operation.fromRowIndex; index < operation.toRowIndex; index += 1) {
      const row = rows[index]
      if (row === undefined) {
        continue
      }
      upserts.set(index + 1, stringValues(row))
    }
  }

  return {
    upserts: [...upserts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ordinal, values]) => ({ ordinal, values })),
    deletes: deletes.sort((a, b) => a - b),
  }
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
