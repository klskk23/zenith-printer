/**
 * One page of a data source's rows, with the controls for moving through it.
 *
 * Extracted when the design page needed the same thing for a different reason:
 * the print dialog picks *which rows to print*, the editor picks *one row for
 * the canvas to stand in for*. Different questions, but a person should not
 * have to learn two tables to answer them — same columns, same paging, same
 * order toggle, same place the tick or the dot sits.
 *
 * Presentational on purpose. Paging, ordering and the fetch belong to whoever
 * is asking, because only they know what a choice means; this draws what they
 * hand over.
 */
import { Pagination } from '../../components/ui/pagination.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.tsx'
import { copy } from '../../i18n/index.ts'
import { useDataSourceTable, ordinalColumn, valueColumns, type DataSourceColumnDef } from './columns.tsx'
import type { DataSourceRow } from './hooks.ts'
import type { RowSelectionState } from '@tanstack/react-table'

export type RowOrder = 'asc' | 'desc'

/** Rows a page holds, wherever this table appears. */
export const ROW_PAGE_SIZE = 10

/**
 * Newest end first.
 *
 * The rows somebody came to find are almost always the ones just added — a
 * batch pasted in this morning, the orders that arrived overnight. Listing from
 * row one meant paging to the end of a growing table to reach them.
 *
 * It is a *viewing* order and nothing else. Printing is by ascending ordinal
 * whatever this says, which is why the print dialog states that out loud.
 */
export const DEFAULT_ROW_ORDER: RowOrder = 'desc'

export interface RowBrowserProps {
  /** The page to draw, already fetched in `order`. */
  rows: readonly DataSourceRow[]
  /** The table's column names, in table order. */
  columns: readonly string[]
  /** Rows in the whole table, not on this page — what the pager divides. */
  total: number
  page: number
  onPageChange: (page: number) => void
  order: RowOrder
  onOrderChange: (order: RowOrder) => void
  /** The leading column that makes a row choosable: a tick box, or a dot. */
  chooseColumn: DataSourceColumnDef
  /** Which rows read as chosen, so the row highlights along with its control. */
  isChosen: (ordinal: number) => boolean
  /** Anything else that belongs on the toolbar, to the left of the order toggle. */
  controls?: React.ReactNode
  /**
   * Makes the whole table one radio group: exactly one row may be chosen.
   *
   * The group has to be an ancestor of every dot, and the dots are cells — so
   * it is put on here rather than left to the caller, who cannot get inside.
   */
  choice?: { value: number | null; onChange: (ordinal: number) => void }
}

export function RowBrowser({
  rows,
  columns,
  total,
  page,
  onPageChange,
  order,
  onOrderChange,
  chooseColumn,
  isChosen,
  controls,
  choice,
}: RowBrowserProps): React.JSX.Element {
  const pageCount = Math.max(1, Math.ceil(total / ROW_PAGE_SIZE))
  const data = [...rows]

  const tableColumns = [chooseColumn, ordinalColumn(), ...valueColumns(columns)]

  // Mirrored into the table so a chosen row is highlighted as such, even
  // though what "chosen" means lives outside it.
  const rowSelection: RowSelectionState = {}
  for (const row of data) {
    if (isChosen(row.ordinal)) {
      rowSelection[String(row.ordinal)] = true
    }
  }

  const table = useDataSourceTable(data, tableColumns, rowSelection)

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        {controls}

        <ToggleGroup
          type="single"
          value={order}
          aria-label={copy.rowSelection.orderLabel}
          onValueChange={(value) => {
            if (value === 'asc' || value === 'desc') {
              onOrderChange(value)
              // Back to the first page: page three of one direction is a
              // different set of rows from page three of the other, and
              // staying put would look like the rows had changed.
              onPageChange(1)
            }
          }}
        >
          <ToggleGroupItem value="asc" aria-label={copy.rowSelection.orderAsc}>
            {copy.rowSelection.orderAsc}
          </ToggleGroupItem>
          <ToggleGroupItem value="desc" aria-label={copy.rowSelection.orderDesc}>
            {copy.rowSelection.orderDesc}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* `ui/table.tsx` already scrolls sideways on its own; a second box
          around it would only be a second scroller. What it needs from above
          is a definite width — see the editor's side columns. */}
      <Choice choice={choice}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Choice>

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        labels={{
          previous: copy.rowSelection.previousPage,
          next: copy.rowSelection.nextPage,
          page: copy.rowSelection.pageNumber,
        }}
      />
    </>
  )
}

/**
 * The radio group around the table, or nothing at all.
 *
 * A deselecting click is ignored: "which row is the canvas standing in for" has
 * no empty answer, and a toggle group will otherwise clear itself when the
 * chosen row is clicked again.
 */
function Choice({
  choice,
  children,
}: {
  choice?: { value: number | null; onChange: (ordinal: number) => void }
  children: React.ReactNode
}): React.JSX.Element {
  if (choice === undefined) {
    return <>{children}</>
  }
  return (
    <ToggleGroup
      type="single"
      value={choice.value === null ? '' : String(choice.value)}
      onValueChange={(value) => {
        if (value !== '') {
          choice.onChange(Number(value))
        }
      }}
      className="block"
    >
      {children}
    </ToggleGroup>
  )
}
