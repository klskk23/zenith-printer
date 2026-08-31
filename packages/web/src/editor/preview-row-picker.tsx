/**
 * Choosing which row of the bound table the canvas stands in for.
 *
 * The same table the print dialog uses, for the same reason a person expects
 * it to be: it is the same data, listed the same way, and having to learn a
 * second control for it would be an accident of which screen you are on.
 *
 * One difference, and it is the point: exactly one row may be chosen. The
 * canvas draws one label, so a tick box promising "and this one too" would be
 * promising something there is no such thing as here.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { useDataSourceRows, useDataSources } from '../features/data-sources/hooks.ts'
import { choiceColumn } from '../features/data-sources/columns.tsx'
import {
  DEFAULT_ROW_ORDER,
  ROW_PAGE_SIZE,
  RowBrowser,
  type RowOrder,
} from '../features/data-sources/row-browser.tsx'

export interface PreviewValuesProps {
  /** Zero rows means no table, or an empty one: nothing to choose between. */
  rowCount: number
  dataSourceId: string | null
  ordinal: number
  onChange: (ordinal: number) => void
  /** The chosen row's cells. */
  values: Readonly<Record<string, string>>
  /** The bound table's column names, in table order. */
  columns: readonly string[]
}

/**
 * The whole 临时值 block: which row, and what that row says.
 *
 * Below the data source rather than above the variables, which is where it
 * started. A ten-row table with its own pager is the tallest thing in this
 * column, and everything under it — including "add a constant" and "new
 * sequence pool" — was a screen of scrolling away. A control you have to go
 * looking for reads as one that is not there.
 */
export function PreviewValues({
  rowCount,
  dataSourceId,
  ordinal,
  onChange,
  values,
  columns,
}: PreviewValuesProps): React.JSX.Element | null {
  if (rowCount < 1 || dataSourceId === null) {
    return null
  }
  return (
    <section className="space-y-2 rounded-md border border-dashed border-border p-2" data-preview-row>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium">{copy.variables.tempHeading}</span>
        <span className="text-2xs text-muted-foreground">
          {copy.variables.tempRowInForce(ordinal, rowCount)}
        </span>
      </div>

      <PreviewRowPicker dataSourceId={dataSourceId} ordinal={ordinal} onChange={onChange} />

      {/*
        The chosen row's values, spelled out.
        The table above is listed newest-first and paged, so the row in force is
        often not on the page being looked at — and "what is the canvas showing
        right now" should not require finding it.
      */}
      {columns.length > 0 && (
        <dl className="space-y-0.5 text-2xs">
          {columns.map((column) => {
            const value = values[column] ?? ''
            return (
              <div key={column} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{column}</dt>
                {/* An empty cell is stated, not left blank: "row 87 has no name"
                    is the case worth stepping through the table to find, and a
                    blank line hides it. */}
                <dd className={value === '' ? 'truncate text-muted-foreground' : 'truncate'}>
                  {value === '' ? copy.variables.tempEmptyCell : value}
                </dd>
              </div>
            )
          })}
        </dl>
      )}

      <p className="text-2xs text-muted-foreground">{copy.variables.tempHint}</p>
    </section>
  )
}

export interface PreviewRowPickerProps {
  dataSourceId: string
  /** The row in force. Row one is the default, as it was before there was a choice. */
  ordinal: number
  onChange: (ordinal: number) => void
}

export function PreviewRowPicker({
  dataSourceId,
  ordinal,
  onChange,
}: PreviewRowPickerProps): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [order, setOrder] = useState<RowOrder>(DEFAULT_ROW_ORDER)
  const rows = useDataSourceRows(dataSourceId, page, ROW_PAGE_SIZE, order)
  const source = useDataSources().data?.find((candidate) => candidate.id === dataSourceId)

  return (
    <div className="space-y-2" data-preview-row-picker>
      <RowBrowser
        rows={rows.data?.rows ?? []}
        columns={source?.columns ?? []}
        total={rows.data?.total ?? 0}
        page={page}
        onPageChange={setPage}
        order={order}
        onOrderChange={setOrder}
        chooseColumn={choiceColumn(ordinal)}
        isChosen={(candidate) => candidate === ordinal}
        choice={{ value: ordinal, onChange }}
      />
    </div>
  )
}
