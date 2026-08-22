/**
 * The table editor.
 *
 * Cells, rows, and paste. Columns are deliberately not editable here: a column
 * name is what a design references, so adding or renaming one from this screen
 * would silently break designs that mention it. Changing the column set means
 * uploading a replacement file, where the consequences can be shown.
 */
import { useMemo, useState } from 'react'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
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
import { PasteOverflowsColumnsError, applyPaste } from './paste.ts'
import { editableValueColumns, ordinalColumn, useDataSourceTable } from './columns.tsx'
import { useDataSourceRows, useDataSources, usePatchRows } from './hooks.ts'

const PAGE_SIZE = 10

export interface DataSourceEditorProps {
  dataSourceId: string
}

export function DataSourceEditor({ dataSourceId }: DataSourceEditorProps): React.JSX.Element {
  const sources = useDataSources()
  const [page, setPage] = useState(1)
  const rows = useDataSourceRows(dataSourceId, page, PAGE_SIZE)
  const patch = usePatchRows()

  const [focused, setFocused] = useState<{ ordinal: number; columnIndex: number } | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const source = sources.data?.find((candidate) => candidate.id === dataSourceId)
  const total = rows.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const setCell = (ordinal: number, column: string, value: string): void => {
    patch.mutate({ id: dataSourceId, upserts: [{ ordinal, values: { [column]: value } }] })
  }

  /**
   * Column definitions come from the shared file, so this table and the row
   * selector cannot disagree about what a column is. Only the cell renderer
   * differs — that is the editing, and it is the one thing that should differ.
   */
  const columns = useMemo(
    () => [
      ordinalColumn(),
      ...editableValueColumns(source?.columns ?? [], {
        onCommit: setCell,
        onFocusCell: (ordinal, columnIndex) => setFocused({ ordinal, columnIndex }),
        renderInput: ({ ordinal, column, columnIndex, value }) => (
          <Input
            aria-label={`${ordinal} ${column}`}
            defaultValue={value}
            onFocus={() => setFocused({ ordinal, columnIndex })}
            onBlur={(event) => {
              if (event.target.value !== value) {
                setCell(ordinal, column, event.target.value)
              }
            }}
          />
        ),
      }),
      {
        id: 'actions',
        header: () => null,
        cell: (ctx) => (
          <ConfirmButton
            variant="ghost"
            size="sm"
            title={copy.dataSources.deleteRow}
            description={copy.dataSources.deleteWarning}
            cancelLabel={copy.common.cancel}
            confirmLabel={copy.dataSources.deleteConfirm}
            onConfirm={() => patch.mutate({ id: dataSourceId, deletes: [ctx.row.original.ordinal] })}
          >
            {copy.dataSources.deleteRow}
          </ConfirmButton>
        ),
      },
    ],
    [source?.columns, dataSourceId],
  )

  const table = useDataSourceTable(rows.data?.rows ?? [], columns)

  // After the hooks, never before: an early return above them changes the hook
  // count between renders, and React tears the component down rather than
  // showing a placeholder.
  if (source === undefined) {
    return <p className="text-sm text-muted-foreground">{copy.common.loading}</p>
  }


  const onPaste = (event: React.ClipboardEvent): void => {
    if (focused === null) return
    const text = event.clipboardData.getData('text/plain')
    if (text.length === 0) return
    event.preventDefault()
    setPasteError(null)

    try {
      const result = applyPaste(text, source.columns, total, focused)
      if (result.upserts.length > 0) {
        patch.mutate({ id: dataSourceId, upserts: result.upserts })
      }
    } catch (err) {
      if (err instanceof PasteOverflowsColumnsError) {
        setPasteError(copy.dataSources.pasteTooWide(err.needed, err.available))
        return
      }
      throw err
    }
  }

  return (
    <div className="space-y-3" data-data-source-editor onPaste={onPaste}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{source.name}</h2>
        <span className="text-xs text-muted-foreground">{copy.dataSources.rowCount(total)}</span>
      </div>

      <p className="text-[11px] text-muted-foreground" data-paste-hint>
        {copy.dataSources.pasteHint}
      </p>

      {pasteError !== null && <Alert variant="destructive">{pasteError}</Alert>}

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
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            patch.mutate({
              id: dataSourceId,
              upserts: [{ ordinal: total + 1, values: { [source.columns[0] ?? '']: '' } }],
            })
          }
        >
          {copy.dataSources.addRow}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {copy.dataSources.prev}
          </Button>
          <span className="text-xs text-muted-foreground">{copy.dataSources.page(page, pageCount)}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            {copy.dataSources.next}
          </Button>
        </div>
      </div>
    </div>
  )
}
