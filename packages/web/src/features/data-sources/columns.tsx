/**
 * Column definitions for the two tables a data source appears in.
 *
 * Shared on purpose: the row selector and the table editor must agree about
 * what a column *is* and how a cell is read, or a value ticked in one is not
 * the value printed from the other. Only the editing behaviour differs, and
 * that is the `cell` renderer, not the column.
 *
 * **Selection state is not TanStack's here.** Its row-selection feature knows
 * only the rows it has been handed, and paging is server-side — so its
 * "select all" would mean "these ten", which is exactly the bug the count on
 * the button exists to prevent. The `Selection` type stays authoritative and
 * this file drives TanStack's state from it.
 */
import {
  coreFeatures,
  rowSelectionFeature,
  useTable,
  type ColumnDef,
  type ReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import { Checkbox } from '../../components/ui/checkbox.tsx'
import { copy } from '../../i18n/index.ts'
import type { DataSourceRow } from './hooks.ts'

export const dataSourceFeatures = { ...coreFeatures, rowSelectionFeature }
export type DataSourceFeatures = typeof dataSourceFeatures

export type DataSourceTable = ReactTable<DataSourceFeatures, DataSourceRow>
export type DataSourceColumnDef = ColumnDef<DataSourceFeatures, DataSourceRow>

/** The ordinal column. Always first: it is what a "5-12" range refers to. */
export function ordinalColumn(): DataSourceColumnDef {
  return {
    id: 'ordinal',
    accessorFn: (row) => row.ordinal,
    header: () => copy.rowSelection.ordinal,
    cell: (ctx) => <span className="font-mono text-xs text-muted-foreground">{String(ctx.getValue())}</span>,
  }
}

/**
 * A tick box, driven from outside.
 *
 * `checked` and `onToggle` come from the caller rather than from the table's
 * own selection state, because "all" has to survive as an intent — see the
 * note at the top of this file.
 */
export function selectionColumn(options: {
  isSelected: (ordinal: number) => boolean
  onToggle: (ordinal: number) => void
}): DataSourceColumnDef {
  return {
    id: 'select',
    header: () => null,
    cell: (ctx) => {
      const ordinal = ctx.row.original.ordinal
      return (
        <Checkbox
          aria-label={`${copy.rowSelection.ordinal} ${ordinal}`}
          checked={options.isSelected(ordinal)}
          onCheckedChange={() => options.onToggle(ordinal)}
        />
      )
    },
  }
}

/** One column per column of the table, read-only. */
export function valueColumns(columns: readonly string[]): DataSourceColumnDef[] {
  return columns.map((column) => ({
    id: `value:${column}`,
    accessorFn: (row: DataSourceRow) => row.values[column] ?? '',
    header: () => column,
    cell: (ctx) => <span className="text-xs">{String(ctx.getValue())}</span>,
  }))
}

/**
 * One column per column of the table, editable.
 *
 * Committed on blur rather than on every keystroke: a PATCH per character
 * would be a request per character, and the value is not interesting until the
 * cell is left.
 */
export function editableValueColumns(
  columns: readonly string[],
  options: {
    onCommit: (ordinal: number, column: string, value: string) => void
    onFocusCell: (ordinal: number, columnIndex: number) => void
    renderInput: (props: {
      ordinal: number
      column: string
      columnIndex: number
      value: string
    }) => React.ReactNode
  },
): DataSourceColumnDef[] {
  return columns.map((column, columnIndex) => ({
    id: `value:${column}`,
    accessorFn: (row: DataSourceRow) => row.values[column] ?? '',
    header: () => column,
    cell: (ctx) =>
      options.renderInput({
        ordinal: ctx.row.original.ordinal,
        column,
        columnIndex,
        value: String(ctx.getValue()),
      }),
  }))
}

/**
 * Build the table instance.
 *
 * `data` is one server page, so no client-side pagination feature is enabled:
 * the rows handed in are already the rows to show, and letting TanStack page
 * them again would page a page.
 */
export function useDataSourceTable(
  data: DataSourceRow[],
  columns: DataSourceColumnDef[],
  rowSelection: RowSelectionState = {},
): DataSourceTable {
  return useTable({
    features: dataSourceFeatures,
    columns,
    data,
    // The ordinal, so a row keeps its identity across a page fetch.
    getRowId: (row) => String(row.ordinal),
    state: { rowSelection },
  })
}
