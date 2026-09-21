/**
 * The draft domain, and the one store the application uses.
 *
 * Real `localStorage` when the browser allows it; a Map otherwise, in which
 * case every write reports `'unpersisted'`-class weakness through
 * `persistence` and the editor tells the person that leaving loses work.
 */
import { createDraftStore, type DraftStore } from './store.ts'
import { isLocalStorageUsable, localDraftStorage, memoryDraftStorage } from './storage.ts'
import { windowId } from './window-id.ts'

export type { CorruptDraft, Draft, DraftIndexEntry, DraftInput } from './schema.ts'
export { draftIndexSchema, draftSchema, isCorrupt } from './schema.ts'
export type { DraftStorage } from './storage.ts'
export { DRAFT_PREFIX, localDraftStorage, memoryDraftStorage } from './storage.ts'
export type { DraftStore, WriteOutcome } from './store.ts'
export { createDraftStore } from './store.ts'
export { dropHistory, trimForStorage } from './trim.ts'
export { changedByAnotherWindow, isBaselineStale } from './version.ts'
export { windowId } from './window-id.ts'

export type Persistence = 'local' | 'memory'

const usable = isLocalStorageUsable()

/** Whether drafts on this browser survive a reload. */
export const persistence: Persistence = usable ? 'local' : 'memory'

export const draftStore: DraftStore = createDraftStore(
  usable ? localDraftStorage() : memoryDraftStorage(),
  () => new Date().toISOString(),
  windowId(),
)
