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
import { useEffect, useMemo, useState } from 'react'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { copy } from '../../i18n/index.ts'
import { useDataSourceRows, useDataSources } from '../data-sources/hooks.ts'
import { selectionColumn } from '../data-sources/columns.tsx'
import {
  DEFAULT_ROW_ORDER,
  ROW_PAGE_SIZE,
  RowBrowser,
  type RowOrder,
} from '../data-sources/row-browser.tsx'
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

export interface RowSelectionPanelProps {
  dataSourceId: string
  selection: Selection
  onChange: (selection: Selection) => void
  copies: number
  /**
   * A row's key, where the table has a key column.
   *
   * Supplied from above because the dialog accumulates it across pages — this
   * panel only ever holds the ten rows it is showing.
   */
  keyOf?: (ordinal: number) => string | undefined
  /** Rows as they arrive, so the dialog can build that lookup. */
  onRowsLoaded?: (rows: readonly { ordinal: number; values: Record<string, string> }[]) => void
}

export function RowSelectionPanel({
  dataSourceId,
  selection,
  onChange,
  copies,
  keyOf,
  onRowsLoaded,
}: RowSelectionPanelProps): React.JSX.Element {
  const sources = useDataSources()
  const [page, setPage] = useState(1)
  /**
   * Which end of the table to list from. A viewing order and nothing else —
   * printing is always by ascending ordinal, which the note below says out
   * loud because a "descending" toggle is otherwise easy to read as "print
   * backwards".
   */
  const [order, setOrder] = useState<RowOrder>(DEFAULT_ROW_ORDER)
  const rows = useDataSourceRows(dataSourceId, page, ROW_PAGE_SIZE, order)
  const [rangeText, setRangeText] = useState('')
  const [rangeInvalid, setRangeInvalid] = useState(false)

  const source = sources.data?.find((candidate) => candidate.id === dataSourceId)
  const total = rows.data?.total ?? 0

  const allOrdinals = useMemo(
    () => Array.from({ length: total }, (_unused, i) => i + 1),
    [total],
  )
  const chosen = selectedCount(selection, total)

  const data = rows.data?.rows ?? []
  const pageOrdinals = useMemo(() => data.map((row) => row.ordinal), [data])

  // Reported upward as they land. The dialog needs a key for every row that
  // was ever ticked, and ticking happens on a row that is on screen.
  useEffect(() => {
    if (data.length > 0) {
      onRowsLoaded?.(data)
    }
  }, [data, onRowsLoaded])

  return (
    <div className="flex flex-col gap-2" data-row-selection>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{copy.rowSelection.heading}</span>
        <span className="text-2xs text-muted-foreground" data-selected-summary>
          {chosen === 0
            ? copy.rowSelection.none
            : copy.rowSelection.selected(chosen, labelTotal(selection, total, copies))}
        </span>
      </div>

      <RowBrowser
        rows={data}
        columns={source?.columns ?? []}
        total={total}
        page={page}
        onPageChange={setPage}
        order={order}
        onOrderChange={setOrder}
        chooseColumn={selectionColumn({
          isSelected: (ordinal) => isSelected(selection, ordinal, keyOf),
          onToggle: (ordinal) => onChange(toggle(selection, ordinal, allOrdinals, keyOf)),
        })}
        isChosen={(ordinal) => isSelected(selection, ordinal, keyOf)}
        controls={
          <>
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
              onClick={() => onChange(togglePage(selection, pageOrdinals, allOrdinals, keyOf))}
              data-select-page
            >
              {isPageSelected(selection, pageOrdinals, keyOf)
                ? copy.rowSelection.pageDeselect
                : copy.rowSelection.pageSelect}
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
          </>
        }
      />

      {rangeInvalid && (
        <p className="text-2xs text-destructive" data-range-invalid>
          {copy.rowSelection.rangeInvalid}
        </p>
      )}

      {/*
        Said next to the control that could be misread. "Descending" is about
        this list; the labels come out in ascending row order either way, which
        is what makes a reprint line up and what lets somebody check the stack
        against the spreadsheet.
      */}
      {order === 'desc' && (
        <p className="text-2xs text-muted-foreground" data-order-note>
          {copy.rowSelection.orderNote}
        </p>
      )}

      {/*
        Said out loud rather than left implied. Content width is not measured
        per row, so silence here would be read as "checked, and fine" (FR-045a).
      */}
      <Alert className="py-1.5 text-2xs">{copy.rowSelection.widthNotChecked}</Alert>
    </div>
  )
}
