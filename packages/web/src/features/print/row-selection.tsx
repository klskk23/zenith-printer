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
import { useDataSourceRows, useDataSources } from '../data-sources/hooks.ts'
import {
  ordinalColumn,
  selectionColumn,
  useDataSourceTable,
  valueColumns,
} from '../data-sources/columns.tsx'
import {
  isSelected,
  labelTotal,
  parseRange,
  selectedCount,
  toggle,
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
  const rows = useDataSourceRows(dataSourceId, page, PAGE_SIZE)
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
        <Button variant="ghost" size="sm" onClick={() => onChange({ kind: 'explicit', ordinals: [] })}>
          {copy.rowSelection.clear}
        </Button>

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

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {copy.dataSources.prev}
        </Button>
        <span className="text-xs text-muted-foreground">{copy.dataSources.page(page, pageCount)}</span>
        <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          {copy.dataSources.next}
        </Button>
      </div>

      {/*
        Said out loud rather than left implied. Content width is not measured
        per row, so silence here would be read as "checked, and fine" (FR-045a).
      */}
      <Alert className="py-1.5 text-[11px]">{copy.rowSelection.widthNotChecked}</Alert>
    </div>
  )
}
