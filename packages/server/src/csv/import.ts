/**
 * CSV import.
 *
 * Every cell stays a string. No type inference, ever: `007` becoming `7` and
 * `2024-01-05` becoming a date are data losses discovered on a printed label,
 * which is the most expensive place to discover anything.
 *
 * The header is not optional. Column names *are* reference names — a design
 * writes `${收件人}` — so a file without them has nothing to reference.
 */
import { detectDelimiter, parseDelimited, type Delimiter } from '@zenith/shared'
import { decodeCsv } from './encoding.ts'

/** Rows per data source. Beyond this the row selector stops being usable and
 *  the job snapshot stops being a reasonable size. */
export const MAX_ROWS = 10_000

export class CsvNoHeaderError extends Error {
  readonly blankAt: number

  constructor(blankAt: number) {
    super(`column ${blankAt + 1} of the header row has no name`)
    this.name = 'CsvNoHeaderError'
    this.blankAt = blankAt
  }
}

export class CsvDuplicateColumnError extends Error {
  readonly columns: string[]

  constructor(columns: string[]) {
    super(`duplicate column name(s): ${columns.join(', ')}`)
    this.name = 'CsvDuplicateColumnError'
    this.columns = columns
  }
}

export class CsvTooManyRowsError extends Error {
  readonly rowCount: number
  readonly maxRows: number

  constructor(rowCount: number) {
    super(`${rowCount} rows exceeds the limit of ${MAX_ROWS}`)
    this.name = 'CsvTooManyRowsError'
    this.rowCount = rowCount
    this.maxRows = MAX_ROWS
  }
}

export interface ImportOptions {
  encoding?: string
  delimiter?: Delimiter
}

export interface ImportedTable {
  columns: string[]
  rows: Array<Record<string, string>>
  /** What was actually used, so the UI can show it and offer to change it. */
  encoding: string
  delimiter: Delimiter
}

/**
 * Line up one data row against the header.
 *
 * A short row gets empty strings rather than missing keys, and a long one is
 * truncated. Both are reported nowhere, deliberately: a ragged export is
 * common, and refusing the whole file over one stray trailing comma would be a
 * worse trade than a few empty cells the user can see and fix.
 */
function toRecord(columns: readonly string[], cells: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [index, column] of columns.entries()) {
    record[column] = cells[index] ?? ''
  }
  return record
}

export function importCsv(bytes: Uint8Array, options: ImportOptions = {}): ImportedTable {
  const { text, encoding } = decodeCsv(bytes, options.encoding)
  const delimiter = options.delimiter ?? detectDelimiter(text)
  const grid = parseDelimited(text, delimiter)

  const header = grid[0]
  if (header === undefined || header.length === 0) {
    throw new CsvNoHeaderError(0)
  }

  const columns = header.map((name) => name.trim())

  const blankAt = columns.findIndex((name) => name.length === 0)
  if (blankAt !== -1) {
    // A column with no name cannot be referenced, so the file has no usable
    // header even though it has a first row.
    throw new CsvNoHeaderError(blankAt)
  }

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const name of columns) {
    if (seen.has(name)) {
      duplicates.add(name)
    }
    seen.add(name)
  }
  if (duplicates.size > 0) {
    // `${收件人}` would have no way to say which column it means.
    throw new CsvDuplicateColumnError([...duplicates])
  }

  const dataRows = grid.slice(1)
  if (dataRows.length > MAX_ROWS) {
    throw new CsvTooManyRowsError(dataRows.length)
  }

  return {
    columns,
    rows: dataRows.map((cells) => toRecord(columns, cells)),
    encoding,
    delimiter,
  }
}
