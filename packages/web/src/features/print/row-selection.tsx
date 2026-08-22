/**
 * Choosing which rows to print.
 *
 * Three ways in, because three different situations turn up: tick a handful,
 * type a range off a packing list, or take the lot. "Take the lot" is a single
 * button that says how many rows it means — a select-all that silently covers
 * only the visible page is the classic version of this control, and it prints
 * ten labels when somebody asked for two hundred.
 *
 * The table is TanStack's, sharing its column definitions with the editor. The
 * *selection* is not: TanStack only knows the rows it has been handed, and
 * paging is server-side, so its own select-all would mean "these ten".
 */
import { useMemo, useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.tsx'
import { copy } from '../../i18n/index.ts'
import { Pagination } from '../../components/ui/pagination.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.tsx'
import { useDataSourceRows, useDataSources } from '../data-sources/hooks.ts'
import {
  ordinalColumn,
  selectionColumn,
  useDataSourceTable,
  valueColumns,
} from '../data-sources/columns.tsx'
import {
  isPageSelected,
  isSelected,
  labelTotal,
  parseRange,
  selectedCount,
  toggle,
  togglePage,
  type Selection,
} from './selection.ts'

const PAGE_SIZE = 10

export interface RowSelectionPanelProps {
  dataSourceId: string
  selection: Selection
  onChange: (selection: Selection) => void
  copies: number
}

export function RowSelectionPanel({
  dataSourceId,
  selection,
  onChange,
  copies,
}: RowSelectionPanelProps): React.JSX.Element {
  const sources = useDataSources()
  const [page, setPage] = useState(1)
  /**
   * Which end of the table to list from. A viewing order and nothing else —
   * printing is always by ascending ordinal, which the note below says out
   * loud because a "descending" toggle is otherwise easy to read as "print
   * backwards".
   */
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const rows = useDataSourceRows(dataSourceId, page, PAGE_SIZE, order)
  const [rangeText, setRangeText] = useState('')
  const [rangeInvalid, setRangeInvalid] = useState(false)

  const source = sources.data?.find((candidate) => candidate.id === dataSourceId)
  const total = rows.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allOrdinals = useMemo(
    () => Array.from({ length: total }, (_unused, i) => i + 1),
    [total],
  )
  const chosen = selectedCount(selection, total)

  const data = rows.data?.rows ?? []
  const pageOrdinals = useMemo(() => data.map((row) => row.ordinal), [data])
  const columns = useMemo(
    () => [
      selectionColumn({
        isSelected: (ordinal) => isSelected(selection, ordinal),
        onToggle: (ordinal) => onChange(toggle(selection, ordinal, allOrdinals)),
      }),
      ordinalColumn(),
      ...valueColumns(source?.columns ?? []),
    ],
    [selection, allOrdinals, source?.columns],
  )

  // Mirrored into the table so its own row state matches what is on screen,
  // even though the selection that gets submitted lives outside it.
  const rowSelection: RowSelectionState = useMemo(() => {
    const state: RowSelectionState = {}
    for (const row of data) {
      if (isSelected(selection, row.ordinal)) {
        state[String(row.ordinal)] = true
      }
    }
    return state
  }, [data, selection])

  const table = useDataSourceTable(data, columns, rowSelection)

  return (
    <div className="space-y-2" data-row-selection>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{copy.rowSelection.heading}</span>
        <span className="text-[11px] text-muted-foreground" data-selected-summary>
          {chosen === 0
            ? copy.rowSelection.none
            : copy.rowSelection.selected(chosen, labelTotal(selection, total, copies))}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange({ kind: 'all' })}>
          {/* The count is on the button: "select all" without it is the control
              that quietly means "this page". */}
          {copy.rowSelection.selectAll(total)}
        </Button>
        {/* Adds to what is already chosen rather than replacing it: paging
            forward and ticking twice must not lose the first page. */}
        <Button
          variant="outline"
          size="sm"
          disabled={pageOrdinals.length === 0}
          onClick={() => onChange(togglePage(selection, pageOrdinals, allOrdinals))}
          data-select-page
        >
          {isPageSelected(selection, pageOrdinals)
            ? copy.rowSelection.pageDeselect
            : copy.rowSelection.pageSelect}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange({ kind: 'explicit', ordinals: [] })}>
          {copy.rowSelection.clear}
        </Button>

        <ToggleGroup
          type="single"
          value={order}
          aria-label={copy.rowSelection.orderLabel}
          onValueChange={(value) => {
            if (value === 'asc' || value === 'desc') {
              setOrder(value)
              // Back to the first page: page three of one direction is a
              // different set of rows from page three of the other, and
              // staying put would look like the rows had changed.
              setPage(1)
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

        <div className="flex items-end gap-1">
          <Input
            aria-label={copy.rowSelection.rangeLabel}
            placeholder={copy.rowSelection.rangePlaceholder}
            value={rangeText}
            onChange={(event) => {
              setRangeText(event.target.value)
              setRangeInvalid(false)
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const ordinals = parseRange(rangeText, total)
              if (ordinals === null) {
                setRangeInvalid(true)
                return
              }
              onChange({ kind: 'explicit', ordinals })
            }}
          >
            {copy.rowSelection.rangeApply}
          </Button>
        </div>
      </div>

      {rangeInvalid && (
        <p className="text-[11px] text-destructive" data-range-invalid>
          {copy.rowSelection.rangeInvalid}
        </p>
      )}

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

      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        labels={{
          previous: copy.rowSelection.previousPage,
          next: copy.rowSelection.nextPage,
          page: copy.rowSelection.pageNumber,
        }}
      />

      {/*
        Said next to the control that could be misread. "Descending" is about
        this list; the labels come out in ascending row order either way, which
        is what makes a reprint line up and what lets somebody check the stack
        against the spreadsheet.
      */}
      {order === 'desc' && (
        <p className="text-[11px] text-muted-foreground" data-order-note>
          {copy.rowSelection.orderNote}
        </p>
      )}

      {/*
        Said out loud rather than left implied. Content width is not measured
        per row, so silence here would be read as "checked, and fine" (FR-045a).
      */}
      <Alert className="py-1.5 text-[11px]">{copy.rowSelection.widthNotChecked}</Alert>
    </div>
  )
}
