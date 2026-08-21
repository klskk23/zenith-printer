/**
 * Local storage, safely.
 *
 * `typeof window !== 'undefined'` is not enough: `window.localStorage` is
 * absent in some test environments, and throws on access in browsers where
 * storage is blocked by policy or by private browsing. Checking for the window
 * and then trusting the property produces `undefined.getItem(...)` at the first
 * read — far from where the assumption was made.
 *
 * Nothing here is important enough to fail over. Preferences and panel widths
 * both have perfectly good defaults, so an unavailable store simply means the
 * defaults every time.
 */

export type SafeStorage = Pick<Storage, 'getItem' | 'setItem'>

const NO_STORAGE: SafeStorage = {
  getItem: () => null,
  setItem: () => undefined,
}

export function safeLocalStorage(): SafeStorage {
  const storage = probeStorage()
  if (storage === null) {
    return NO_STORAGE
  }

  // Wrapped rather than returned directly. A write probe says nothing about
  // whether reads work — a store can pass the probe and then throw on the
  // first getItem, which is where the failure would surface instead.
  return {
    getItem: (key) => {
      try {
        return storage.getItem(key)
      } catch {
        return null
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value)
      } catch {
        // Nothing stored here is worth failing over; the defaults are valid.
      }
    },
  }
}

function probeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage as Storage | undefined
    if (storage === undefined || storage === null) {
      return null
    }
    // Storage can be present and still refuse to be used — private browsing
    // and enterprise policies both do this — so try it rather than assume.
    const probe = '__zenith_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

export function isStorageAvailable(): boolean {
  return probeStorage() !== null
}
