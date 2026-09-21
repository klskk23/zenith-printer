/**
 * The storage a draft store writes to.
 *
 * Deliberately not `lib/storage.ts`'s `safeLocalStorage`. That one swallows
 * every failure, on the stated grounds that nothing it holds is worth failing
 * over — preferences have defaults. A draft is the opposite: it is somebody's
 * last hour, and a write that silently did nothing is the one outcome the
 * whole mechanism exists to prevent. So `setItem` here throws the way the
 * browser does, and the store above decides what to give up.
 */
import { isStorageAvailable } from '../../lib/storage.ts'

export const DRAFT_PREFIX = 'zenith.drafts.v1.'

export interface DraftStorage {
  getItem(key: string): string | null
  /** Throws `QuotaExceededError` (or whatever the browser throws) when it cannot. */
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** Every key under `DRAFT_PREFIX`, and only those. */
  keys(): string[]
}

/** The real thing, passed through untouched. */
export function localDraftStorage(storage: Storage = globalThis.localStorage): DraftStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    keys: () => {
      const found: string[] = []
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (key !== null && key.startsWith(DRAFT_PREFIX)) {
          found.push(key)
        }
      }
      return found
    },
  }
}

/**
 * A Map, for tests and for browsers that refuse `localStorage`.
 *
 * In the second case the draft mechanism still runs — the editor still gets
 * its undo history back after a page switch within the session — it just
 * cannot promise anything past a reload, and says so (FR-025).
 */
export function memoryDraftStorage(seed: Record<string, string> = {}): DraftStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()].filter((key) => key.startsWith(DRAFT_PREFIX)),
  }
}

/** Whether `localDraftStorage()` can be used at all. Same probe as preferences. */
export function isLocalStorageUsable(): boolean {
  return isStorageAvailable()
}
