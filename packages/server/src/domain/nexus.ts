/**
 * The seam between this system and the asset ledger it prints labels for.
 *
 * Same shape and the same reason as `SheetsPort`: everything this feature needs
 * from the other side passes through one narrow port, so the whole default test
 * suite runs with no network and nothing to stand up.
 *
 * **Almost nothing about the connection is stored here.** The address and the
 * key come from the environment, exactly as the Google credentials do, and the
 * key column is a constant. What a data source keeps is a category id and
 * nothing else.
 *
 * That is not tidiness. A URL or a key copied into the database is a second
 * copy of a deployment decision, and the two drift the first time somebody
 * moves the ledger or rotates a key: the environment says one thing, ten data
 * sources say another, and the only symptom is a refresh that started failing.
 * Nothing can drift out of step with a value it does not hold.
 */
import { z } from 'zod'
import { rowEnvelopeSchema, type RowEnvelope } from '@zenith/shared'

/**
 * Which column names a row, fixed rather than asked for.
 *
 * The ledger's own device id: a UUID that survives being renamed, recategorised
 * and re-serialled. Offering the choice would be offering somebody the chance
 * to pick a column that is *not* stable, and the failure that produces — rows
 * shifting under a selection somebody already made — is silent.
 */
export const NEXUS_KEY_COLUMN = 'sys_id'

/** How many rows to ask for at a time. The other side reports what it gave. */
export const NEXUS_PAGE_SIZE = 1000

export const nexusCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string(),
  name: z.string(),
  parent_id: z.string().nullable().optional(),
  /** `/ancestor/…/self/`, so a list can be indented without a second request. */
  path: z.string().optional(),
  display_key: z.string().optional(),
})
export type NexusCategory = z.infer<typeof nexusCategorySchema>

export const nexusCategoriesSchema = z.array(nexusCategorySchema)

/**
 * Why a call failed, as a closed set.
 *
 * Closed because each becomes a different sentence and a different repair. A
 * key the ledger no longer accepts and a ledger that is switched off need
 * different answers, and "it didn't work" is not one anybody can act on.
 */
export const NEXUS_ERROR_KINDS = [
  'notConfigured',
  'unauthorised',
  'badRequest',
  'unreachable',
  'badShape',
  'tooManyRows',
] as const
export type NexusErrorKind = (typeof NEXUS_ERROR_KINDS)[number]

export class NexusError extends Error {
  readonly kind: NexusErrorKind
  readonly detail: string

  constructor(kind: NexusErrorKind, detail = '') {
    super(detail.length > 0 ? `${kind}: ${detail}` : kind)
    this.name = 'NexusError'
    this.kind = kind
    this.detail = detail
  }
}

export interface NexusPort {
  /** The categories, for the one dropdown this feature has. */
  categories(locale: string): Promise<NexusCategory[]>
  /** One page of a category's rows, descendants included. */
  rows(request: { categoryId: string; offset: number; limit: number; locale: string }): Promise<RowEnvelope>
}

/**
 * Fetch every row of a category, following the ledger's paging.
 *
 * The ceiling is checked against the declared total **before** paging through
 * it: refusing at the end means having already pulled a hundred thousand rows
 * into memory to discover they were too many, which is what the ceiling is for.
 */
export async function fetchCategoryRows(
  port: NexusPort,
  categoryId: string,
  locale: string,
  limit: number,
): Promise<{ columns: string[]; rows: Array<Record<string, string>>; total: number }> {
  const collected: Array<Record<string, string>> = []
  let columns: string[] | null = null
  let offset = 0

  for (;;) {
    const page = await port.rows({ categoryId, offset, limit: NEXUS_PAGE_SIZE, locale })
    const total = page.total ?? page.rows.length

    if (total > limit) {
      throw new NexusError('tooManyRows', `${total} > ${limit}`)
    }

    // The first page decides the columns. A later page that disagreed would
    // mean the ledger changed its mind mid-read, and stitching the two together
    // would produce rows the envelope's own rule forbids.
    if (columns === null) {
      columns = page.columns
    } else if (page.columns.join(' ') !== columns.join(' ')) {
      throw new NexusError('badShape', 'the columns changed between pages')
    }

    collected.push(...page.rows)
    if (collected.length > limit) {
      throw new NexusError('tooManyRows', `${collected.length} > ${limit}`)
    }

    if (page.rows.length === 0 || collected.length >= total) {
      return { columns, rows: collected, total }
    }
    if (collected.length <= offset) {
      // A ledger whose paging does not advance would spin here forever.
      throw new NexusError('badShape', `paging did not advance past offset ${offset}`)
    }
    offset = collected.length
  }
}

/** Parse a body the ledger returned as rows, or say where it stopped making sense. */
export function parseRowEnvelope(body: unknown): RowEnvelope {
  const parsed = rowEnvelopeSchema.safeParse(body)
  if (parsed.success) {
    return parsed.data
  }
  const issue = parsed.error.issues[0]
  const where = (issue?.path ?? []).join('.')
  const message = issue?.message ?? 'unrecognised'
  throw new NexusError('badShape', where.length > 0 ? `${where}: ${message}` : message)
}
