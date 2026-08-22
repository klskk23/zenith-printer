/**
 * Choosing which rows to print.
 *
 * Three ways in, because three different situations turn up: tick a handful,
 * type a range off a packing list, or take the lot. "Take the lot" is a single
 * button that says how many rows it means — a select-all that silently covers
 * only the visible page is the classic version of this control, and it prints
 * ten labels when somebody asked for two hundred.
 */
import { useState } from 'react'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Checkbox } from '../../components/ui/checkbox.tsx'
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
  const allOrdinals = Array.from({ length: total }, (_unused, i) => i + 1)
  const chosen = selectedCount(selection, total)

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
          <TableRow>
            <TableHead />
            <TableHead>{copy.rowSelection.ordinal}</TableHead>
            {source?.columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.data?.rows.map((row) => (
            <TableRow key={row.ordinal}>
              <TableCell>
                <Checkbox
                  aria-label={`${copy.rowSelection.ordinal} ${row.ordinal}`}
                  checked={isSelected(selection, row.ordinal)}
                  onCheckedChange={() => onChange(toggle(selection, row.ordinal, allOrdinals))}
                />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{row.ordinal}</TableCell>
              {source?.columns.map((column) => (
                <TableCell key={column} className="text-xs">
                  {row.values[column] ?? ''}
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
