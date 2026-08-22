/**
 * The template interchange file.
 *
 * One format serves two jobs: moving a design to another machine, and keeping
 * a readable archive of one. The second is the first with the file staying
 * put, so the format is designed for the harder case — self-contained, with
 * nothing in it that only means something on the machine it came from.
 *
 * Three kinds of reference have to survive the trip, and each is handled
 * differently because each fails differently:
 *
 *   - **Image assets** travel as bytes, keyed by content hash. A reference
 *     would be a reference to a file the receiving machine has never seen, and
 *     a missing image is the one failure here that is completely silent: the
 *     renderer skips the element and nothing anywhere says so.
 *   - **Sequence pools** travel as a *definition* — name, digits, step, first
 *     number — and never as a counter. Carrying the counter would leave two
 *     machines both believing they own the same range, and the duplicate
 *     serials would only be visible with the printed labels side by side
 *     (FR-006).
 *   - **Data sources** travel as an identity — id, name, column names — and
 *     never as rows. Rows are business data, not design; a file sent to the
 *     wrong person should not also be a customer list.
 *
 * What is refused is narrow on purpose: a file this machine cannot *represent*
 * — malformed, a newer format, an element type it does not know. A file whose
 * references do not resolve is imported and reported on, because a design
 * missing its table is still the design somebody meant to send.
 */
import { z } from 'zod'
import { labelElementSchema, variableDefinitionsSchema } from '@zenith/shared'
import { printerKindSchema } from './printer.ts'
import { templateNameSchema } from './template.ts'

export const FILE_KIND = 'zenith.templates'

/**
 * Bumped when a change would make an older reader misunderstand a file.
 *
 * Readers refuse a higher version rather than guessing: a design read with
 * half its meaning is worse than one that would not open.
 */
export const FORMAT_VERSION = 1

/** A sequence pool's definition. No counter — see the note at the top. */
export const exportedPoolSchema = z.object({
  name: z.string().min(1).max(60),
  digits: z.number().int().min(1).max(12),
  step: z.number().int().min(1),
  /** The first number this pool issues. */
  floor: z.number().int().min(0),
})

/** A data source's identity and shape. No rows — see the note at the top. */
export const exportedDataSourceSchema = z.object({
  name: z.string().min(1).max(60),
  columns: z.array(z.string()),
})

export const exportedAssetSchema = z.object({
  mimeType: z.string().min(1),
  /** Kept so the receiving machine's asset list reads like the sender's. */
  filename: z.string().min(1),
  base64: z.string().min(1),
})

export const exportedTemplateSchema = z.object({
  id: z.string().min(1),
  name: templateNameSchema,
  printerKind: printerKindSchema,
  widthMm: z.number().finite().positive(),
  heightMm: z.number().finite().positive(),
  dpi: z.number().int().positive(),
  /** `assetId` on image elements is a content hash here, not a local id. */
  elements: z.array(labelElementSchema),
  variables: variableDefinitionsSchema,
  dataSourceId: z.string().nullable(),
})

export const exportFileSchema = z.object({
  /** Names the format, so a JSON that is not ours fails with a sentence. */
  kind: z.literal(FILE_KIND),
  formatVersion: z.number().int().positive(),
  templates: z.array(exportedTemplateSchema).min(1),
  /** Keyed by the pool id the templates refer to. */
  pools: z.record(z.string(), exportedPoolSchema).default({}),
  /** Keyed by the data source id the templates refer to. */
  dataSources: z.record(z.string(), exportedDataSourceSchema).default({}),
  /** Keyed by content hash, which is also what image elements point at. */
  assets: z.record(z.string(), exportedAssetSchema).default({}),
})

export type ExportFile = z.infer<typeof exportFileSchema>
export type ExportedPool = z.infer<typeof exportedPoolSchema>
export type ExportedDataSource = z.infer<typeof exportedDataSourceSchema>
export type ExportedTemplate = z.infer<typeof exportedTemplateSchema>

/**
 * Something worth saying about an import that the result itself cannot show.
 *
 * Structured rather than prose so the caller decides how to say it, and so a
 * script can branch on `code` instead of matching text. `message` is filled in
 * by the API in the negotiated language — the same rule the error bodies
 * follow, so one fault never gets two descriptions.
 */
export interface ImportWarning {
  code:
    | 'DATA_SOURCE_MISSING'
    | 'DATA_SOURCE_MATCHED_BY_NAME'
    | 'DATA_SOURCE_COLUMNS_DIFFER'
    | 'SEQUENCE_POOL_MATCHED_BY_NAME'
    | 'SEQUENCE_POOL_CREATED'
    | 'LABEL_WIDER_THAN_ANY_PRINTER'
  templateName: string
  detail: Record<string, string | number | readonly string[]>
}

export interface PoolLike {
  id: string
  name: string
}

/**
 * Which pool an imported sequence variable should point at.
 *
 * By id first, so restoring onto the machine a file came from lands exactly
 * where it was. Then by name, which is what the same pool is called after a
 * trip — but reported, because two pools sharing a name are not two names for
 * one pool, and drawing serials from another product line's counter is not
 * something to do quietly. Failing both, the definition travelled with the
 * file and a new pool is made from it.
 */
export function resolvePool(
  poolId: string,
  definition: ExportedPool | undefined,
  existing: readonly PoolLike[],
): { poolId: string } | { matchedByName: PoolLike } | { create: ExportedPool } | { unresolved: true } {
  const byId = existing.find((pool) => pool.id === poolId)
  if (byId !== undefined) {
    return { poolId: byId.id }
  }
  if (definition === undefined) {
    // A file that names a pool but does not describe it. Nothing to create
    // from and nothing to match against, so the reference stays dangling.
    return { unresolved: true }
  }
  const byName = existing.find((pool) => pool.name === definition.name)
  if (byName !== undefined) {
    return { matchedByName: byName }
  }
  return { create: definition }
}

export interface SourceLike {
  id: string
  name: string
  columns: readonly string[]
}

/**
 * Which data source an imported design should be bound to.
 *
 * Same ladder as the pools, minus the last rung: a table cannot be created
 * from a file that deliberately carries no rows. An unmatched binding is left
 * dangling, which the existing `bindingIssue` already reports on the card and
 * in the designer — the design is recoverable by rebinding, which is why it is
 * a warning and not a refusal (FR-028a).
 */
export function resolveDataSource(
  sourceId: string,
  definition: ExportedDataSource | undefined,
  existing: readonly SourceLike[],
): { sourceId: string } | { matchedByName: SourceLike; missingColumns: string[] } | { unresolved: true } {
  const byId = existing.find((source) => source.id === sourceId)
  if (byId !== undefined) {
    return { sourceId: byId.id }
  }
  if (definition === undefined) {
    return { unresolved: true }
  }
  const byName = existing.find((source) => source.name === definition.name)
  if (byName === undefined) {
    return { unresolved: true }
  }
  const present = new Set(byName.columns)
  return {
    matchedByName: byName,
    // Reported, not refused: the design binds and says which columns it
    // expected to find. Half a table is still a starting point.
    missingColumns: definition.columns.filter((column) => !present.has(column)),
  }
}

/** Rewrite every image element's `assetId` through a map, leaving the rest alone. */
export function remapAssetIds(
  elements: readonly z.infer<typeof labelElementSchema>[],
  map: ReadonlyMap<string, string>,
): z.infer<typeof labelElementSchema>[] {
  return elements.map((element) =>
    element.type === 'image' && map.has(element.assetId)
      ? { ...element, assetId: map.get(element.assetId)! }
      : element,
  )
}
