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
 * Where an http source reads from.
 *
 * **Header values are not here, and that is the design.** They carry whatever
 * credential the other end wants, and this object is what `GET
 * /api/data-sources` returns. Redacting on the way out would work until
 * somebody added a second endpoint; a shape that never holds the values cannot
 * leak them from any endpoint. The names travel, so a person can see that an
 * Authorization header is configured without being told what it says.
 *
 * Same rule as the Google private key living only in the environment: a service
 * with no authentication must not hand back the means of authenticating
 * somewhere else.
 */
export interface HttpOrigin {
  url: string
  headerNames: string[]
}

export type DataSourceKind = 'local' | 'google-sheets' | 'http'

export interface DataSource {
  id: string
  name: string
  columns: string[]
  /** Denormalised so the list page does not COUNT(*) over ten thousand rows. */
  rowCount: number
  sourceKind: DataSourceKind
  /** Non-null exactly when `sourceKind` is `google-sheets`. */
  link: DataSourceLink | null
  /** Non-null exactly when `sourceKind` is `http`. */
  http: HttpOrigin | null
  /**
   * Which column names a row, or null where identity is still position.
   *
   * Required for an http source and meaningless without one: a table that
   * changes on its own needs a name for a row that survives the change.
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
 * Configuring a source that reads rows from an address.
 *
 * `headers` is where a credential goes. It is stored and never returned — see
 * `HttpOrigin` — so this is the only shape in which its values ever appear.
 *
 * `refreshIntervalSeconds` defaults to 0, which means "only when asked" and is
 * exactly what this product did before there was any alternative. Automatic
 * refreshing is offered because a key column makes it safe, not because
 * staleness became more urgent; it stays a choice.
 */
export const httpSourceInputSchema = z.object({
  name: dataSourceNameSchema,
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
      message: 'the address must be http or https',
    }),
  headers: z.record(z.string().min(1), z.string()).default({}),
  /** Which column names a row. Required: see domain/row-upsert.ts. */
  keyColumn: z.string().trim().min(1),
  refreshIntervalSeconds: z.number().int().min(0).max(86_400).default(0),
  refreshBeforePrint: z.boolean().default(false),
})
export type HttpSourceInput = z.infer<typeof httpSourceInputSchema>

/**
 * Changing how an existing source reads.
 *
 * Written out rather than `httpSourceInputSchema.partial()`, because that
 * schema gives `headers` a default of `{}` — and a default survives
 * `.partial()`. Sending any unrelated field would then arrive carrying an empty
 * header set and **wipe the stored credential**, silently, with the next
 * refresh failing on a 401 nobody could explain.
 *
 * Here every field is genuinely absent when it is not sent, and absent means
 * "leave it alone". The caller cannot read the credential back, so requiring
 * them to resend it would be requiring them to know it.
 */
export const httpSourcePatchSchema = z.object({
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
      message: 'the address must be http or https',
    })
    .optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  keyColumn: z.string().trim().min(1).optional(),
  refreshIntervalSeconds: z.number().int().min(0).max(86_400).optional(),
  refreshBeforePrint: z.boolean().optional(),
})
export type HttpSourcePatch = z.infer<typeof httpSourcePatchSchema>
