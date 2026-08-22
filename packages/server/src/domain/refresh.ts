/**
 * What a refresh should do, worked out before anything is written.
 *
 * Three outcomes and only one of them touches the database. The other two are
 * the cases where going ahead would be worse than doing nothing:
 *
 *   - a column the designs referenced has gone, which would make every
 *     `${that column}` resolve to nothing — and a blank on a label is not a
 *     failure anybody notices until the labels are in their hands;
 *   - more rows than a data source may hold, where the alternative is to keep
 *     the first ten thousand and leave nobody aware the rest existed.
 */
import { classifyColumnChange } from './column-change.ts'
import { MAX_ROWS } from './data-source.ts'
import type { SheetTable } from './sheet-table.ts'

export type RefreshDecision =
  | { kind: 'apply'; columnsAdded: string[] }
  | { kind: 'needsConfirmation'; removedColumns: string[]; addedColumns: string[] }
  | { kind: 'refusedTooManyRows'; rowCount: number; limit: number }

export function decideRefresh(
  current: { columns: readonly string[] },
  next: SheetTable,
  options: { confirmed: boolean },
): RefreshDecision {
  // Row count first. Confirming a header change is not consent to lose ten
  // thousand rows, so the larger problem has to be the one reported.
  if (next.rows.length > MAX_ROWS) {
    return { kind: 'refusedTooManyRows', rowCount: next.rows.length, limit: MAX_ROWS }
  }

  const change = classifyColumnChange(current.columns, next.columns)
  if (change.kind === 'breaking' && !options.confirmed) {
    return {
      kind: 'needsConfirmation',
      removedColumns: change.removed,
      addedColumns: change.added,
    }
  }

  return {
    kind: 'apply',
    columnsAdded: change.kind === 'unchanged' ? [] : change.added,
  }
}
