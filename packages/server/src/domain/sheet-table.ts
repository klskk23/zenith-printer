/**
 * A worksheet's values, read as columns and rows.
 *
 * The header is the first row and a column name is a reference name — a design
 * writes `${收件人}` — so the rules here match the CSV importer's, and for the
 * same reason: a malformed column becomes a reference nobody can write, or one
 * that resolves to nothing on a printed label.
 *
 * Nothing is parsed or coerced. The values arrive as the text the cell
 * displays, and that is what gets stored (FR-010).
 */

export class TableShapeError extends Error {
  readonly reason: 'empty' | 'duplicate' | 'blank'

  constructor(reason: 'empty' | 'duplicate' | 'blank', message: string) {
    super(message)
    this.name = 'TableShapeError'
    this.reason = reason
  }
}

export interface SheetTable {
  columns: string[]
  rows: Array<Record<string, string>>
}

export function tableFromValues(values: readonly (readonly string[])[]): SheetTable {
  const header = values[0]
  if (header === undefined) {
    throw new TableShapeError('empty', 'the worksheet is empty')
  }

  // Sheets reports a few blank columns past the real ones more often than not.
  // Those are slack, not columns; a hole *between* real columns is a different
  // thing and is refused below.
  let end = header.length
  while (end > 0 && (header[end - 1] ?? '').trim().length === 0) {
    end -= 1
  }
  const columns = header.slice(0, end).map((name) => name.trim())

  if (columns.length === 0) {
    throw new TableShapeError('empty', 'the worksheet has an empty header row')
  }
  const blank = columns.indexOf('')
  if (blank !== -1) {
    throw new TableShapeError(
      'blank',
      `column ${blank + 1} of the header row is blank`,
    )
  }
  const seen = new Set<string>()
  for (const name of columns) {
    if (seen.has(name)) {
      throw new TableShapeError('duplicate', `duplicate column name: ${name}`)
    }
    seen.add(name)
  }

  const rows = values.slice(1).map((row) => {
    const record: Record<string, string> = {}
    for (const [index, column] of columns.entries()) {
      // Every column present on every row: an absent key reads as "leave the
      // old value" downstream, so clearing a cell would silently do nothing.
      record[column] = row[index] ?? ''
    }
    return record
  })

  return { columns, rows }
}
