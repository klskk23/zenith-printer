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

/**
 * Where a ledger-backed source reads from: a category, and nothing else.
 *
 * No address and no credential, because neither is stored — both come from the
 * environment, the same road the Google key travels. A copy of a deployment
 * decision drifts from the decision; a shape with nowhere to put one cannot.
 *
 * It also cannot leak a credential from any endpoint, which matters because
 * this service has no authentication of its own.
 */
export interface NexusOrigin {
  categoryId: string
}

export type DataSourceKind = 'local' | 'google-sheets' | 'nexus'

export interface DataSource {
  id: string
  name: string
  columns: string[]
  /** Denormalised so the list page does not COUNT(*) over ten thousand rows. */
  rowCount: number
  sourceKind: DataSourceKind
  /** Non-null exactly when `sourceKind` is `google-sheets`. */
  link: DataSourceLink | null
  /** Non-null exactly when `sourceKind` is `nexus`. */
  nexus: NexusOrigin | null
  /**
   * Which column names a row, or null where identity is still position.
   *
   * **Derived, not stored.** A ledger-backed source is keyed by the ledger's own
   * device id; every other kind has no identity beyond its order, and inventing
   * one would be pretending.
   */
  keyColumn: string | null
  /** How stale the rows may get before a page refreshes them. 0 = only on request. */
  refreshIntervalSeconds: number
  /** Whether submitting a job refreshes first. Only allowed with a key column. */
  refreshBeforePrint: boolean
  /** When the rows last came from elsewhere; null for a table nobody fetches. */
  lastRefreshedAt: string | null
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

/**
 * Connecting a source to the ledger.
 *
 * One field. The address, the credential and the key column are all decided
 * elsewhere — the first two by the deployment, the third by what the ledger
 * calls its device id — so there is nothing else here for anybody to get wrong.
 *
 * `name` is optional and defaults to the category's own name: a data source is
 * labelled for people, and the category already has a label people chose.
 */
export const nexusSourceInputSchema = z.object({
  categoryId: z.string().min(1),
  name: dataSourceNameSchema.optional(),
})
export type NexusSourceInput = z.infer<typeof nexusSourceInputSchema>

/** How stale a source's rows may get, and whether a job refreshes first. */
export const refreshPolicySchema = z.object({
  refreshIntervalSeconds: z.number().int().min(0).max(86_400).optional(),
  refreshBeforePrint: z.boolean().optional(),
})
export type RefreshPolicy = z.infer<typeof refreshPolicySchema>
