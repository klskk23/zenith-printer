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
import { useDataSourceRows, useDataSources } from '../features/data-sources/hooks.ts'
import { choiceColumn } from '../features/data-sources/columns.tsx'
import {
  DEFAULT_ROW_ORDER,
  ROW_PAGE_SIZE,
  RowBrowser,
  type RowOrder,
} from '../features/data-sources/row-browser.tsx'

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
