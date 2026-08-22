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
 * level.
 *
 * **Edits are staged.** Typing changes a local draft; nothing reaches the
 * server until Save. Every keystroke used to be a PATCH, which meant a
 * mis-paste was already the stored table by the time it was noticed, and undo
 * was a second round-trip trying to put it back. Staging makes Cancel free and
 * makes Save one patch instead of dozens.
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
import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DataSheetGrid, keyColumn, type DataSheetGridRef } from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Separator } from '../../components/ui/separator.tsx'
import { AddRowsBar } from './add-rows.tsx'
import { GridContextMenu } from './grid-context-menu.tsx'
import { RefreshButton } from './refresh-button.tsx'
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
  stringColumn,
  toGridRows,
  type GridRow,
} from './grid-operations.ts'
import { MAX_ROWS, useDataSourceRows, useDataSources, usePatchRows } from './hooks.ts'
import { useWorkspace } from '../../app/workspace.tsx'

/** Room for the surrounding chrome; the grid takes the rest of the window. */
const CHROME_PX = 220

export interface DataSourceEditorProps {
  dataSourceId: string
  /** Lets the tab show a dot and ask before closing over unsaved rows. */
  tabId: string
}

export function DataSourceEditor({ dataSourceId, tabId }: DataSourceEditorProps): React.JSX.Element {
  const sources = useDataSources()
  // The whole table in one request. See the note at the top about paging.
  const rows = useDataSourceRows(dataSourceId, 1, MAX_ROWS)
  const patch = usePatchRows()
  const workspace = useWorkspace()
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

  /** What the server holds. The draft is measured against this. */
  const saved = useMemo(
    () => toGridRows(rows.data?.rows ?? [], columnNames),
    [rows.data?.rows, columnNames],
  )

  /**
   * The staged table.
   *
   * `null` means "no unsaved edits", which is a different thing from "a draft
   * that happens to equal what is saved": after Save the draft is dropped so
   * that a later refresh from the server is actually shown, rather than being
   * masked by a stale copy of the same rows.
   */
  const [draft, setDraft] = useState<GridRow[] | null>(null)
  const value = draft ?? saved
  const dirty = draft !== null

  /**
   * Undo and redo, over the draft alone.
   *
   * The stack holds whole tables rather than inverse operations — an inverse
   * for "delete a row" has to know that the server renumbers, and one that is
   * subtly wrong writes one row's values over another's. A snapshot cannot
   * drift from the thing it describes.
   */
  const [history, setHistory] = useState<History<GridRow[]>>(emptyHistory)

  const onChange = (next: GridRow[]): void => {
    setHistory((current) => pushHistory(current, value))
    setDraft(next)
  }

  const step = (direction: 'undo' | 'redo'): void => {
    const taken = direction === 'undo' ? undoStep(history, value) : redoStep(history, value)
    if (taken.state === null) {
      return
    }
    setHistory(taken.history)
    setDraft(taken.state)
  }

  const save = (): void => {
    if (draft === null) {
      return
    }
    const changes = diffRows(saved, draft)
    if (changes.upserts.length === 0 && changes.deletes.length === 0) {
      // Edited back to where it started. Nothing to send, but the draft still
      // has to go, or the tab stays marked as having unsaved work.
      setDraft(null)
      setHistory(emptyHistory)
      return
    }
    patch.mutate(
      { id: dataSourceId, ...changes },
      {
        // Only on success: a draft dropped after a failed save would take the
        // user's rows with it, which is the one outcome worse than the error.
        onSuccess: () => {
          setDraft(null)
          setHistory(emptyHistory)
        },
      },
    )
  }

  const discard = (): void => {
    setDraft(null)
    setHistory(emptyHistory)
  }

  // The tab shows the dot and asks before closing; the browser asks before a
  // reload. Neither knows about this draft unless it is told.
  //
  // Depends on `setDirty`, which is stable, rather than on the workspace object,
  // whose identity changes with every state change — including this one.
  const setDirty = workspace.setDirty
  useEffect(() => {
    setDirty(tabId, dirty)
  }, [tabId, dirty, setDirty])

  /**
   * Bound on the container rather than on the document.
   *
   * A page-wide Ctrl+Z would fight the designer's own undo when both are open,
   * and the two histories are not the same history.
   */
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      step(event.shiftKey ? 'redo' : 'undo')
      return
    }
    if (key === 's') {
      // Otherwise the browser offers to save the page, which is nobody's
      // intention in a table editor.
      event.preventDefault()
      save()
    }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{source.name}</h2>
          {dirty && (
            <span className="text-xs text-muted-foreground" data-unsaved>
              {copy.dataSources.unsaved}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Icon buttons, the same shape as the designer's: the two pages
              have the same undo and it should not look like two different
              features. Buttons as well as the shortcut — an editor whose only
              undo is a key combination has no undo for anyone who does not
              know it. */}
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              disabled={!history.canUndo}
              aria-label={copy.dataSources.undo}
              title={copy.dataSources.undoTitle}
              onClick={() => step('undo')}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={!history.canRedo}
              aria-label={copy.dataSources.redo}
              title={copy.dataSources.redoTitle}
              onClick={() => step('redo')}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-9" />

          {/* Discarding cannot be undone — the draft is the only copy — so it
              asks first, and only while there is something to lose. */}
          <ConfirmButton
            variant="outline"
            size="sm"
            disabled={!dirty || patch.isPending}
            title={copy.common.confirmTitle}
            description={copy.dataSources.discardConfirm}
            cancelLabel={copy.common.cancel}
            confirmLabel={copy.dataSources.discard}
            onConfirm={discard}
          >
            {copy.dataSources.discard}
          </ConfirmButton>
          <Button
            size="sm"
            disabled={!dirty || patch.isPending}
            title={copy.dataSources.saveTitle}
            onClick={save}
          >
            {patch.isPending ? copy.dataSources.saving : copy.common.save}
          </Button>

          <RefreshButton source={source} />
          <span className="text-xs text-muted-foreground">
            {copy.dataSources.rowCount(value.length)}
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
