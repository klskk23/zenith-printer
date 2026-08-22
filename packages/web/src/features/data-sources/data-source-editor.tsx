/**
 * The table editor — a spreadsheet, not a form.
 *
 * The previous version put a focusable `<input>` in every cell. That makes the
 * ordinary things impossible: the input swallows the keyboard, so there is no
 * cell cursor to move, no rectangle to select, and nothing for Ctrl+C to copy.
 * Pasting a block from Excel had to be retyped cell by cell, which is the one
 * thing this page exists to avoid.
 *
 * react-datasheet-grid owns the cursor and the clipboard instead: its cell
 * inputs are `tabIndex=-1` and it handles selection, copy and paste at the grid
 * level. What we keep is the seam — translating its change description into a
 * row patch (`grid-operations.ts`).
 *
 * **No paging.** Every row is loaded and the rendering is virtualised. Paging
 * is what made copying a block across a page boundary impossible, and a
 * spreadsheet that pages is not one.
 *
 * Columns are still not editable here: a column name is what a design
 * references, so renaming one from this screen would silently break designs
 * that mention it. Changing the column set means uploading a replacement,
 * where the consequences can be shown.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DataSheetGrid, keyColumn, type DataSheetGridRef } from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { AddRowsBar } from './add-rows.tsx'
import { GridContextMenu } from './grid-context-menu.tsx'
import {
  diffRows,
  emptyHistory,
  pushHistory,
  redo as redoStep,
  undo as undoStep,
  type History,
} from './table-history.ts'
import { copy } from '../../i18n/index.ts'
import {
  emptyGridRow,
  patchFromOperations,
  stringColumn,
  toGridRows,
  type GridOperation,
  type GridRow,
} from './grid-operations.ts'
import { MAX_ROWS, useDataSourceRows, useDataSources, usePatchRows } from './hooks.ts'

/** Room for the surrounding chrome; the grid takes the rest of the window. */
const CHROME_PX = 220

export interface DataSourceEditorProps {
  dataSourceId: string
}

export function DataSourceEditor({ dataSourceId }: DataSourceEditorProps): React.JSX.Element {
  const sources = useDataSources()
  // The whole table in one request. See the note at the top about paging.
  const rows = useDataSourceRows(dataSourceId, 1, MAX_ROWS)
  const patch = usePatchRows()
  const grid = useRef<DataSheetGridRef>(null)

  const [height, setHeight] = useState(480)
  useEffect(() => {
    // The grid takes a pixel height, not a CSS one, so it has to be told.
    const measure = (): void => setHeight(Math.max(240, window.innerHeight - CHROME_PX))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const source = sources.data?.find((candidate) => candidate.id === dataSourceId)
  const columnNames = useMemo(() => source?.columns ?? [], [source?.columns])

  const columns = useMemo(
    () =>
      columnNames.map((column) => ({
        // Never null, never parsed — the same rule as the importer, for the
        // same reason: `007` must stay `007` (FR-024).
        ...keyColumn<GridRow, string>(column, stringColumn),
        title: column,
        minWidth: 120,
      })),
    [columnNames],
  )

  const value = useMemo(
    () => toGridRows(rows.data?.rows ?? [], columnNames),
    [rows.data?.rows, columnNames],
  )

  /**
   * Undo and redo.
   *
   * The stack holds whole tables rather than inverse operations. Going back
   * then means diffing the table we want against the one there is and sending
   * that — the same shape as any other edit, and it cannot drift from the thing
   * it describes the way a hand-written inverse can.
   *
   * `value` is what the server currently holds; the stack records what it held
   * before each edit.
   */
  const [history, setHistory] = useState<History<GridRow[]>>(emptyHistory)

  const onChange = (next: GridRow[], operations: GridOperation[]): void => {
    const changes = patchFromOperations(next, operations)
    if (changes.upserts.length === 0 && changes.deletes.length === 0) {
      return
    }
    setHistory((current) => pushHistory(current, value))
    patch.mutate({ id: dataSourceId, ...changes })
  }

  const step = (direction: 'undo' | 'redo'): void => {
    const taken = direction === 'undo' ? undoStep(history, value) : redoStep(history, value)
    if (taken.state === null) {
      return
    }
    const changes = diffRows(value, taken.state)
    setHistory(taken.history)
    if (changes.upserts.length > 0 || changes.deletes.length > 0) {
      patch.mutate({ id: dataSourceId, ...changes })
    }
  }

  /**
   * Bound on the container rather than on the document.
   *
   * A page-wide Ctrl+Z would fight the designer's own undo when both are open,
   * and the two histories are not the same history.
   */
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') {
      return
    }
    event.preventDefault()
    step(event.shiftKey ? 'redo' : 'undo')
  }

  if (source === undefined) {
    return <p className="text-sm text-muted-foreground">{copy.common.loading}</p>
  }

  return (
    <div
      className="flex h-full flex-col gap-2"
      data-data-source-editor
      onKeyDown={onKeyDown}
      // Needed for the key handler: without it the container never receives a
      // keydown, and the grid's own focus traps are the only focusable things.
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{source.name}</h2>
        <div className="flex items-center gap-2">
          {/* Buttons as well as the shortcut: an editor whose only undo is a
              key combination has no undo for anyone who does not know it. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={!history.canUndo}
            title={copy.dataSources.undoTitle}
            onClick={() => step('undo')}
          >
            {copy.dataSources.undo}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!history.canRedo}
            title={copy.dataSources.redoTitle}
            onClick={() => step('redo')}
          >
            {copy.dataSources.redo}
          </Button>
          <span className="text-xs text-muted-foreground">
            {copy.dataSources.rowCount(rows.data?.total ?? source.rowCount)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground" data-paste-hint>
        {copy.dataSources.gridHint}
      </p>

      {patch.isError && <Alert variant="destructive">{copy.dataSources.patchFailed}</Alert>}

      <DataSheetGrid<GridRow>
        ref={grid}
        value={value}
        onChange={onChange}
        columns={columns}
        height={height}
        // A pasted block running past the end appends rows rather than being
        // clipped; this is what those rows start as.
        createRow={() => emptyGridRow(columnNames)}
        // Columns are fixed, so a duplicated row must carry every one of them —
        // an absent key would read as "leave the old value".
        duplicateRow={({ rowData }) => ({ ...emptyGridRow(columnNames), ...rowData })}
        // The library's own bar is an unstyled button and an English label at
        // the foot of the page; this one is built from the same primitives as
        // everything around it.
        addRowsComponent={AddRowsBar}
        // The only way to delete a row, so it cannot stay English on white.
        contextMenuComponent={GridContextMenu}
      />
    </div>
  )
}
