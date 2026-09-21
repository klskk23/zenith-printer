/**
 * The draft store: reads, writes and the degrading sequence for a full store.
 *
 * Never throws. Every failure this can meet — a browser that refuses the
 * write, a key that holds garbage, an index that disagrees with the keys — is
 * turned into a return value the editor can show, because a draft that
 * fails silently is the one thing this module exists to prevent.
 *
 * Injected clock and window id: a draft's `updatedAt` and `writerId` are
 * what the version checks compare, so a test has to be able to say exactly
 * what they were.
 */
import {
  draftIndexSchema,
  draftSchema,
  isCorrupt,
  type CorruptDraft,
  type Draft,
  type DraftIndex,
  type DraftIndexEntry,
  type DraftInput,
} from './schema.ts'
import { DRAFT_PREFIX, type DraftStorage } from './storage.ts'
import { dropHistory, trimForStorage } from './trim.ts'

export type WriteOutcome = 'stored' | 'stored-without-history' | 'unpersisted'

export interface DraftStore {
  /** null when absent; `{corrupt: true}` when present but unreadable. */
  read(draftId: string): Draft | CorruptDraft | null
  /** Tries as given, then without history, then gives up — see WriteOutcome. */
  write(input: DraftInput): WriteOutcome
  remove(draftId: string): void
  /** The index, reconciled against the keys that actually exist. */
  list(): { entries: DraftIndexEntry[]; corrupt: string[] }
  /** Every draft. The caller owns the confirmation (FR-024). */
  clear(): void
}

const INDEX_KEY = `${DRAFT_PREFIX}index`
const draftKey = (draftId: string): string => `${DRAFT_PREFIX}d.${draftId}`
const idOfKey = (key: string): string | null =>
  key.startsWith(`${DRAFT_PREFIX}d.`) ? key.slice(`${DRAFT_PREFIX}d.`.length) : null

export function createDraftStore(storage: DraftStorage, clock: () => string, windowId: string): DraftStore {
  const read = (draftId: string): Draft | CorruptDraft | null => {
    const raw = storage.getItem(draftKey(draftId))
    if (raw === null) {
      return null
    }
    try {
      const parsed = draftSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : { corrupt: true, draftId }
    } catch {
      return { corrupt: true, draftId }
    }
  }

  const readIndex = (): DraftIndex => {
    const raw = storage.getItem(INDEX_KEY)
    if (raw === null) {
      return { version: 1, entries: [] }
    }
    try {
      const parsed = draftIndexSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : { version: 1, entries: [] }
    } catch {
      return { version: 1, entries: [] }
    }
  }

  const entryOf = (draft: Draft): DraftIndexEntry => ({
    draftId: draft.draftId,
    templateId: draft.templateId,
    name: draft.name,
    widthMm: draft.present.widthMm,
    heightMm: draft.present.heightMm,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  })

  /** Index writes are best-effort: `list()` rebuilds from the keys anyway. */
  const writeIndex = (entries: DraftIndexEntry[]): void => {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify({ version: 1, entries } satisfies DraftIndex))
    } catch {
      // The keys are the truth; the index heals on the next list().
    }
  }

  const upsertIndex = (draft: Draft): void => {
    const entries = readIndex().entries.filter((entry) => entry.draftId !== draft.draftId)
    writeIndex([...entries, entryOf(draft)])
  }

  const tryStore = (draft: Draft): boolean => {
    try {
      storage.setItem(draftKey(draft.draftId), JSON.stringify(draft))
      return true
    } catch {
      return false
    }
  }

  const write = (input: DraftInput): WriteOutcome => {
    const existing = read(input.draftId)
    const createdAt =
      input.createdAt ?? (existing !== null && !isCorrupt(existing) ? existing.createdAt : clock())
    const draft: Draft = { ...trimForStorage(input), createdAt, updatedAt: clock(), writerId: windowId }

    if (tryStore(draft)) {
      upsertIndex(draft)
      return 'stored'
    }
    const lighter = dropHistory(draft)
    if (tryStore(lighter)) {
      upsertIndex(lighter)
      return 'stored-without-history'
    }
    return 'unpersisted'
  }

  const remove = (draftId: string): void => {
    storage.removeItem(draftKey(draftId))
    writeIndex(readIndex().entries.filter((entry) => entry.draftId !== draftId))
  }

  const list = (): { entries: DraftIndexEntry[]; corrupt: string[] } => {
    const known = new Map(readIndex().entries.map((entry) => [entry.draftId, entry]))
    const entries: DraftIndexEntry[] = []
    const corrupt: string[] = []
    let dirty = false

    const present = new Set<string>()
    for (const key of storage.keys()) {
      const draftId = idOfKey(key)
      if (draftId === null) {
        continue
      }
      present.add(draftId)
      const draft = read(draftId)
      if (draft === null) {
        continue
      }
      if (isCorrupt(draft)) {
        corrupt.push(draftId)
        continue
      }
      const entry = known.get(draftId)
      if (entry === undefined || entry.updatedAt !== draft.updatedAt) {
        dirty = true
        entries.push(entryOf(draft))
      } else {
        entries.push(entry)
      }
    }
    if (known.size !== entries.length || [...known.keys()].some((id) => !present.has(id))) {
      dirty = true
    }
    if (dirty) {
      writeIndex(entries)
    }
    return { entries, corrupt }
  }

  const clear = (): void => {
    for (const key of storage.keys()) {
      storage.removeItem(key)
    }
  }

  return { read, write, remove, list, clear }
}
