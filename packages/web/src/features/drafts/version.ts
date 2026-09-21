/**
 * Two questions a draft has to answer before the editor trusts it.
 */
import type { Draft } from './schema.ts'

/**
 * Has the server moved past the version this draft started from?
 *
 * If so a save will be refused with 409, and the person should hear that
 * before adding an hour to the draft — not after. A label with no server
 * version yet cannot be stale: there is nothing newer to lose.
 */
export function isBaselineStale(draft: Pick<Draft, 'baseVersion'>, serverVersion: number): boolean {
  return draft.baseVersion !== null && serverVersion > draft.baseVersion
}

/**
 * Did another window on this machine write this draft after I last did?
 *
 * Last write wins between windows (no locking — without authentication a
 * lock has no owner), so the losing window is told rather than left to think
 * the edits on its screen are its own. `lastWrittenAt` is null when this
 * window has never written the draft; a draft that exists anyway was
 * therefore written by someone else.
 */
export function changedByAnotherWindow(
  draft: Pick<Draft, 'writerId' | 'updatedAt'>,
  windowId: string,
  lastWrittenAt: string | null,
): boolean {
  if (draft.writerId === windowId) {
    return false
  }
  return lastWrittenAt === null || draft.updatedAt > lastWrittenAt
}
