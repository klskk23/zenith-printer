/**
 * Turning a clipboard paste into cell edits.
 *
 * Google Sheets and Excel both put tab-separated text on the clipboard
 * alongside an HTML table. The TSV is already the shape we want; the HTML would
 * mean handling merged cells, nested markup and styling in exchange for
 * "keeping the formatting" — and there is no formatting to keep, because every
 * cell here is text.
 *
 * Quoting is shared with the CSV importer: a cell containing a newline arrives
 * quoted exactly as a CSV would write it, and two parsers disagreeing about
 * that would split one row into two.
 */
import { parseDelimited } from '@zenith/shared'

export interface PasteTarget {
  /** Where the paste starts, 1-based, matching the ordinals on screen. */
  ordinal: number
  /** Column index within the table's column list, 0-based. */
  columnIndex: number
}

export interface PasteResult {
  upserts: Array<{ ordinal: number; values: Record<string, string> }>
  /** Rows the paste adds past the end of the table. */
  appended: number
}

export class PasteOverflowsColumnsError extends Error {
  readonly needed: number
  readonly available: number

  constructor(needed: number, available: number) {
    super(`the pasted block is ${needed} columns wide; only ${available} are available`)
    this.name = 'PasteOverflowsColumnsError'
    this.needed = needed
    this.available = available
  }
}

/**
 * Split a clipboard payload into a grid.
 *
 * Text that is not a table — one line, no tabs — comes back as a single cell.
 * Refusing it would be pedantic: pasting a value into a cell is the most
 * ordinary thing somebody can do here (FR-050).
 */
export function pasteGrid(text: string): string[][] {
  const normalised = text.replace(/\r\n?$/, '')
  if (normalised.length === 0) {
    return []
  }
  return parseDelimited(normalised, '\t')
}

/**
 * Lay a pasted grid over the table, spreadsheet-style: from the selected cell,
 * rightwards and downwards.
 *
 * Rows past the end are appended. Columns past the last are **refused**: a
 * column name is what a design references, and a column that appeared from a
 * paste would have got there without anybody choosing to call it anything
 * (FR-049).
 */
export function applyPaste(
  text: string,
  columns: readonly string[],
  rowCount: number,
  target: PasteTarget,
): PasteResult {
  const grid = pasteGrid(text)
  if (grid.length === 0) {
    return { upserts: [], appended: 0 }
  }

  const widest = Math.max(...grid.map((row) => row.length))
  const available = columns.length - target.columnIndex
  if (widest > available) {
    throw new PasteOverflowsColumnsError(widest, available)
  }

  const upserts = grid.map((cells, offset) => {
    const values: Record<string, string> = {}
    for (const [index, cell] of cells.entries()) {
      const column = columns[target.columnIndex + index]
      if (column !== undefined) {
        values[column] = cell
      }
    }
    return { ordinal: target.ordinal + offset, values }
  })

  const lastOrdinal = target.ordinal + grid.length - 1
  return { upserts, appended: Math.max(0, lastOrdinal - rowCount) }
}
