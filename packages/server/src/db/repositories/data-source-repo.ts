/**
 * Data source persistence.
 *
 * Row values are one JSON object per row rather than real columns. Column names
 * come from somebody's spreadsheet header — arbitrary text — and the whole set
 * is replaced when a new file is uploaded, so a wide table would mean an ALTER
 * on every import. JSON makes "column" data instead of schema.
 */
import type { Database } from '../index.ts'
import type { Clock, IdGenerator } from '../../clock.ts'
import {
  MAX_ROWS,
  type DataSource,
  type DataSourceLink,
  type DataSourceRow,
} from '../../domain/data-source.ts'

type Row = Record<string, unknown>

export interface CreateDataSourceInput {
  name: string
  columns: string[]
  rows: Array<Record<string, string>>
}

export interface CreateLinkedInput extends CreateDataSourceInput {
  link: Omit<DataSourceLink, 'lastRefreshedAt'>
}

export interface ReplaceLinkedInput {
  columns: string[]
  rows: Array<Record<string, string>>
  /** Re-read from the worksheet id, so a rename in Google does not strand us. */
  worksheetTitle: string
}

export class DataSourceRepo {
  readonly #db: Database
  readonly #clock: Clock
  readonly #ids: IdGenerator

  constructor(deps: { db: Database; clock: Clock; ids: IdGenerator }) {
    this.#db = deps.db
    this.#clock = deps.clock
    this.#ids = deps.ids
  }

  #toSource(row: Row): DataSource {
    return {
      id: String(row.id),
      name: String(row.name),
      columns: JSON.parse(String(row.columns)) as string[],
      rowCount: Number(row.row_count),
      sourceKind: String(row.source_kind) as DataSource['sourceKind'],
      link:
        row.spreadsheet_id === null || row.spreadsheet_id === undefined
          ? null
          : {
              spreadsheetId: String(row.spreadsheet_id),
              spreadsheetTitle: String(row.spreadsheet_title),
              worksheetId: Number(row.worksheet_id),
              worksheetTitle: String(row.worksheet_title),
              lastRefreshedAt: String(row.last_refreshed_at),
            },
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  /** The stored row, for tests that need to see the columns themselves. */
  rawRow(id: string): Record<string, unknown> {
    return this.#db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
  }

  /**
   * Create a data source backed by a spreadsheet.
   *
   * `lastRefreshedAt` is set now rather than left null: the rows being written
   * *are* the result of a read, and calling that "never refreshed" would be a
   * lie the list page would then display.
   */
  createLinked(input: CreateLinkedInput): DataSource {
    const created = this.create({ name: input.name, columns: input.columns, rows: input.rows })
    this.#db
      .prepare(
        `UPDATE data_sources
            SET source_kind = 'google-sheets', spreadsheet_id = ?, spreadsheet_title = ?,
                worksheet_id = ?, worksheet_title = ?, last_refreshed_at = ?
          WHERE id = ?`,
      )
      .run(
        input.link.spreadsheetId,
        input.link.spreadsheetTitle,
        input.link.worksheetId,
        input.link.worksheetTitle,
        this.#clock.now().toISOString(),
        created.id,
      )
    return this.find(created.id)!
  }

  /** Replace a linked source's columns and rows wholesale, as a refresh does. */
  replaceLinked(id: string, input: ReplaceLinkedInput): void {
    this.#db.exec('BEGIN')
    try {
      this.#db
        .prepare('UPDATE data_sources SET columns = ?, worksheet_title = ?, last_refreshed_at = ? WHERE id = ?')
        .run(JSON.stringify(input.columns), input.worksheetTitle, this.#clock.now().toISOString(), id)
      this.#writeRows(id, input.rows)
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * Sever the link, keeping every row.
   *
   * The origin is cleared rather than hidden: nothing afterwards can decide the
   * source is "sort of" still linked. What remains is exactly what uploading a
   * CSV would have produced.
   */
  unlink(id: string): void {
    this.#db
      .prepare(
        `UPDATE data_sources
            SET source_kind = 'local', spreadsheet_id = NULL, spreadsheet_title = NULL,
                worksheet_id = NULL, worksheet_title = NULL, last_refreshed_at = NULL,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(this.#clock.now().toISOString(), id)
  }

  list(): DataSource[] {
    return this.#db
      .prepare('SELECT * FROM data_sources ORDER BY name')
      .all()
      .map((row) => this.#toSource(row as Row))
  }

  find(id: string): DataSource | undefined {
    const row = this.#db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id)
    return row === undefined ? undefined : this.#toSource(row as Row)
  }

  findByName(name: string): DataSource | undefined {
    const row = this.#db.prepare('SELECT * FROM data_sources WHERE name = ?').get(name)
    return row === undefined ? undefined : this.#toSource(row as Row)
  }

  #writeRows(sourceId: string, rows: readonly Record<string, string>[]): void {
    this.#db.prepare('DELETE FROM data_source_rows WHERE source_id = ?').run(sourceId)
    const insert = this.#db.prepare(
      'INSERT INTO data_source_rows (source_id, ordinal, values_json) VALUES (?, ?, ?)',
    )
    for (const [index, values] of rows.entries()) {
      insert.run(sourceId, index + 1, JSON.stringify(values))
    }
    this.#db
      .prepare('UPDATE data_sources SET row_count = ?, updated_at = ? WHERE id = ?')
      .run(rows.length, this.#clock.now().toISOString(), sourceId)
  }

  create(input: CreateDataSourceInput): DataSource {
    const id = this.#ids.next()
    const now = this.#clock.now().toISOString()

    // One transaction: a data source whose rows failed to land would look
    // imported and print blanks.
    this.#db.exec('BEGIN')
    try {
      this.#db
        .prepare(
          `INSERT INTO data_sources (id, name, columns, row_count, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
        )
        .run(id, input.name, JSON.stringify(input.columns), now, now)
      this.#writeRows(id, input.rows)
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }

    const created = this.find(id)
    if (created === undefined) {
      throw new Error(`data source ${id} vanished immediately after insert`)
    }
    return created
  }

  rename(id: string, name: string): void {
    this.#db
      .prepare('UPDATE data_sources SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, this.#clock.now().toISOString(), id)
  }

  /** Replace the whole table: new columns, new rows. */
  replace(id: string, columns: readonly string[], rows: readonly Record<string, string>[]): void {
    this.#db.exec('BEGIN')
    try {
      this.#db.prepare('UPDATE data_sources SET columns = ? WHERE id = ?').run(JSON.stringify(columns), id)
      this.#writeRows(id, rows)
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
  }

  delete(id: string): void {
    // Rows go with it: the foreign key cascades.
    this.#db.prepare('DELETE FROM data_sources WHERE id = ?').run(id)
  }

  #toRow(row: Row): DataSourceRow {
    return {
      ordinal: Number(row.ordinal),
      values: JSON.parse(String(row.values_json)) as Record<string, string>,
    }
  }

  /**
   * One page of rows, ordered by position in the table.
   *
   * `desc` is a *viewing* order and nothing else. Printing always goes by
   * ascending ordinal whatever was selected or however it was listed, so that
   * a reprint lines up and the labels come out in the order somebody can check
   * them against the spreadsheet.
   *
   * The direction has to be applied here rather than by reversing a page in
   * the browser: page one descending is the *last* ten rows of the table, not
   * the first ten upside down.
   */
  page(sourceId: string, page: number, pageSize: number, desc = false): DataSourceRow[] {
    return this.#db
      .prepare(
        `SELECT ordinal, values_json FROM data_source_rows WHERE source_id = ?
          ORDER BY ordinal ${desc ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
      )
      .all(sourceId, pageSize, (page - 1) * pageSize)
      .map((row) => this.#toRow(row as Row))
  }

  allRows(sourceId: string): DataSourceRow[] {
    return this.#db
      .prepare('SELECT ordinal, values_json FROM data_source_rows WHERE source_id = ? ORDER BY ordinal')
      .all(sourceId)
      .map((row) => this.#toRow(row as Row))
  }

  /** Ordinals a selection can legally name. */
  ordinals(sourceId: string): number[] {
    return this.#db
      .prepare('SELECT ordinal FROM data_source_rows WHERE source_id = ? ORDER BY ordinal')
      .all(sourceId)
      .map((row) => Number((row as Row).ordinal))
  }

  /** Values of the named rows, in the order given. */
  rowsAt(sourceId: string, ordinals: readonly number[]): Array<Record<string, string>> {
    if (ordinals.length === 0) {
      return []
    }
    const byOrdinal = new Map(this.allRows(sourceId).map((row) => [row.ordinal, row.values]))
    return ordinals.map((ordinal) => byOrdinal.get(ordinal) ?? {})
  }

  /**
   * Apply edits from the table editor.
   *
   * Ordinals are renumbered afterwards so they stay a contiguous 1..n: they are
   * what a "5-12" selection refers to, and a table with holes in its numbering
   * makes that range mean something different from what the screen shows.
   */
  patchRows(
    sourceId: string,
    patch: { upserts: Array<{ ordinal: number; values: Record<string, string> }>; deletes: number[] },
  ): number {
    const current = new Map(this.allRows(sourceId).map((row) => [row.ordinal, row.values]))

    for (const ordinal of patch.deletes) {
      current.delete(ordinal)
    }
    for (const upsert of patch.upserts) {
      current.set(upsert.ordinal, { ...(current.get(upsert.ordinal) ?? {}), ...upsert.values })
    }

    const ordered = [...current.entries()].sort((a, b) => a[0] - b[0]).map(([, values]) => values)
    if (ordered.length > MAX_ROWS) {
      const error = new Error(`${ordered.length} rows exceeds the limit of ${MAX_ROWS}`)
      error.name = 'TooManyRowsError'
      throw error
    }

    this.#db.exec('BEGIN')
    try {
      this.#writeRows(sourceId, ordered)
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
    return ordered.length
  }
}
