/**
 * Table data source.
 *
 * A global object: a table is not owned by a design, and the same order list
 * can feed a box label and a shipping label.
 *
 * The **name is a label, not an identifier**. Designs bind by id, so renaming
 * is free and changes nothing. That was not true while references carried a
 * source prefix, which is the whole reason the name used to be immutable.
 */
import { z } from 'zod'

export { MAX_ROWS } from '../csv/import.ts'

/** Any character but `}`, which would close a `${}` reference (FR-009a). */
const columnNameSchema = z
  .string()
  .transform((name) => name.trim())
  .refine((name) => name.length > 0, { message: 'a column must have a name' })
  .refine((name) => !name.includes('}'), { message: 'a column name must not contain "}"' })

export const dataSourceNameSchema = z.string().trim().min(1).max(60)

export const dataSourceColumnsSchema = z
  .array(columnNameSchema)
  .min(1)
  .refine((columns) => new Set(columns).size === columns.length, {
    // A duplicate leaves `${收件人}` with no way to say which column it means.
    message: 'column names must be unique',
  })

/**
 * Where a data source's rows come from, when they come from elsewhere.
 *
 * `worksheetId` is the stable handle — a worksheet can be renamed in Google and
 * keeps its id — while `worksheetTitle` is what the read endpoint addresses it
 * by. Both are kept, and the title is refreshed from the id on every read;
 * storing only the title would break on a rename that broke nothing.
 */
export interface DataSourceLink {
  spreadsheetId: string
  spreadsheetTitle: string
  worksheetId: number
  worksheetTitle: string
  lastRefreshedAt: string
}

export type DataSourceKind = 'local' | 'google-sheets'

export interface DataSource {
  id: string
  name: string
  columns: string[]
  /** Denormalised so the list page does not COUNT(*) over ten thousand rows. */
  rowCount: number
  sourceKind: DataSourceKind
  /** Non-null exactly when `sourceKind` is not `local`. */
  link: DataSourceLink | null
  createdAt: string
  updatedAt: string
}

export interface DataSourceRow {
  ordinal: number
  values: Record<string, string>
}

/** Edits from the table editor and the paste path. */
export const rowPatchSchema = z.object({
  upserts: z
    .array(z.object({ ordinal: z.number().int().min(1), values: z.record(z.string(), z.string()) }))
    .default([]),
  deletes: z.array(z.number().int().min(1)).default([]),
})
export type RowPatch = z.infer<typeof rowPatchSchema>

export class UnknownColumnError extends Error {
  readonly columns: string[]

  constructor(columns: string[]) {
    super(`this table has no column(s): ${columns.join(', ')}`)
    this.name = 'UnknownColumnError'
    this.columns = columns
  }
}

/**
 * Reject values naming a column the table does not have.
 *
 * Columns cannot be conjured up by an edit: the name is what a design
 * references, and a column that appeared from a paste would have arrived
 * without anybody choosing to call it that (FR-049).
 */
export function assertKnownColumns(columns: readonly string[], values: Record<string, string>): void {
  const known = new Set(columns)
  const unknown = Object.keys(values).filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new UnknownColumnError(unknown)
  }
}
