/**
 * One id per browser window, for the life of that window.
 *
 * Stamped onto every draft this window writes, so that a draft found later
 * can say whether it was this window or another one that last touched it.
 * `sessionStorage` is exactly the right scope — per tab, gone when it
 * closes — and when it is unavailable the id lives for the page load only,
 * which is the same thing from the draft's point of view.
 */
import { randomId } from '../../lib/random-id.ts'

const KEY = 'zenith.window'

let inMemory: string | null = null

function sessionOrNull(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export function windowId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = sessionOrNull(),
  random: () => string = randomId,
): string {
  if (storage !== null) {
    try {
      const existing = storage.getItem(KEY)
      if (existing !== null && existing !== '') {
        return existing
      }
      const fresh = random()
      storage.setItem(KEY, fresh)
      return fresh
    } catch {
      // Blocked storage: fall through to the in-memory id.
    }
  }
  inMemory ??= random()
  return inMemory
}
