/**
 * What a draft is, as stored.
 *
 * A draft is a label's unsaved state on this browser: the content, the undo
 * stack behind it, and enough about where it came from to tell whether the
 * server has moved on since. It lives in `localStorage`, which makes it
 * outside input — written by an older version, edited by hand, cut off
 * mid-write — so everything read back is parsed through these schemas and
 * anything that fails is reported as corrupt rather than trusted.
 *
 * The key layout, the failure semantics and the reason for every field are
 * in specs/005-nocturne-web-redesign/contracts/draft-store.md.
 */
import { z } from 'zod'
import { labelIrSchema, variableDefinitionSchema } from '@zenith/shared'
import { UNDO_LIMIT } from '../../editor/undo.ts'

export const draftSchema = z.object({
  /** This browser's key: the template id for a saved label, a random id for a new one. */
  draftId: z.string().min(1),
  /** The server label this is a draft of; null for a label never saved. */
  templateId: z.string().min(1).nullable(),
  /** The server `version` the draft started from; null for a new label. */
  baseVersion: z.number().int().nonnegative().nullable(),
  present: labelIrSchema,
  /** Undo history, oldest first. Never longer than the editor's own limit. */
  past: z.array(labelIrSchema).max(UNDO_LIMIT),
  variables: z.array(variableDefinitionSchema),
  dataSourceId: z.string().nullable(),
  /** A name typed before the first save; null until then. */
  name: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** The browser window that last wrote it — see window-id.ts. */
  writerId: z.string().min(1),
})

export type Draft = z.infer<typeof draftSchema>

/** What a caller hands the store: the store stamps the rest. */
export type DraftInput = Omit<Draft, 'createdAt' | 'updatedAt' | 'writerId'> & {
  createdAt?: string
}

export const draftIndexEntrySchema = z.object({
  draftId: z.string().min(1),
  templateId: z.string().min(1).nullable(),
  name: z.string().nullable(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type DraftIndexEntry = z.infer<typeof draftIndexEntrySchema>

/**
 * The index: one key listing every draft, so the gallery can show what
 * exists without deserialising every label. `version` is the shape version;
 * a different number is a shape this code does not know and must not read
 * as if it did.
 */
export const draftIndexSchema = z.object({
  version: z.literal(1),
  entries: z.array(draftIndexEntrySchema),
})

export type DraftIndex = z.infer<typeof draftIndexSchema>

/** A stored draft that could not be read. Listed, never silently dropped. */
export interface CorruptDraft {
  corrupt: true
  draftId: string
}

export function isCorrupt(value: Draft | CorruptDraft): value is CorruptDraft {
  return 'corrupt' in value
}
