/**
 * What a draft gives up when storage is short.
 *
 * History first, content never. The undo stack is whole-IR snapshots, so it
 * is the bulk of a draft and also the part that can be lost without losing
 * the label. `trimForStorage` is the normal case (the editor's own limit,
 * applied again in case a caller passed more); `dropHistory` is the fallback
 * when the browser refuses the trimmed draft.
 */
import { UNDO_LIMIT } from '../../editor/undo.ts'
import type { DraftInput } from './schema.ts'

export function trimForStorage<T extends Pick<DraftInput, 'past'>>(draft: T): T {
  if (draft.past.length <= UNDO_LIMIT) {
    return draft
  }
  return { ...draft, past: draft.past.slice(-UNDO_LIMIT) }
}

export function dropHistory<T extends Pick<DraftInput, 'past'>>(draft: T): T {
  return { ...draft, past: [] }
}
