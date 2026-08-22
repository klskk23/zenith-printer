/**
 * Driving react-datasheet-grid from a test.
 *
 * Three things about it are not obvious and cost an afternoon to find out:
 *
 *   1. It listens on `document`, not on its own container. A paste fired at
 *      the grid element never reaches it.
 *   2. Its paste handler is **async** — it awaits `prePasteValues` across the
 *      columns — so the change lands on a microtask, not synchronously.
 *   3. Its cells are hit-tested from pointer coordinates, and happy-dom does
 *      no layout, so a click cannot select a cell. The imperative ref is the
 *      only way in.
 */
import { act, fireEvent } from '@testing-library/react'

export interface GridHandle {
  setActiveCell: (cell: { col: number; row: number } | null) => void
  setSelection: (selection: { min: { col: number; row: number }; max: { col: number; row: number } } | null) => void
}

/** Put the cursor on a cell. Column 0 is the first *data* column. */
export function activateCell(grid: { current: GridHandle | null }, col: number, row: number): void {
  act(() => grid.current?.setActiveCell({ col, row }))
}

/** Select a rectangle, for the copy path. */
export function selectRange(
  grid: { current: GridHandle | null },
  from: { col: number; row: number },
  to: { col: number; row: number },
): void {
  act(() => grid.current?.setSelection({ min: from, max: to }))
}

/**
 * Paste a TSV block at the current selection.
 *
 * Dispatched on `document` and awaited, for reasons 1 and 2 above.
 */
export async function pasteTsv(tsv: string): Promise<void> {
  const data = new DataTransfer()
  data.setData('text/plain', tsv)
  await act(async () => {
    fireEvent.paste(document, { clipboardData: data })
    await Promise.resolve()
  })
}

/** The values currently shown, row by row, read out of the cell inputs. */
export function gridValues(columnCount: number): string[][] {
  const inputs = [...document.querySelectorAll('.dsg-row:not(.dsg-row-header) input.dsg-input')]
  const rows: string[][] = []
  for (let index = 0; index < inputs.length; index += columnCount) {
    rows.push(inputs.slice(index, index + columnCount).map((input) => (input as HTMLInputElement).value))
  }
  return rows
}
