/**
 * The workspace: which page is open.
 *
 * This used to be a set of tabs, kept as a reducer so that the one property
 * everything depended on — an inactive tab keeps its editing state — could be
 * asserted without rendering. That property now lives in drafts
 * (features/drafts): the editor writes its state to storage as it goes and
 * reads it back on the way in, so a page can be unmounted without losing
 * anything. With that, the set had no reason to exist, and this is what is
 * left of it.
 */
import { pageFromPath, type PageDescriptor } from './routes.ts'
import { randomId } from '../lib/random-id.ts'

export interface WorkspaceState {
  page: PageDescriptor
  /**
   * The open label's draft could not be written — the one case where leaving
   * the page really loses work. Gates the browser's leave prompt.
   */
  unpersisted: boolean
  /**
   * The open label's draft lives only in memory (a browser without local
   * storage): switching pages keeps it, a reload does not. Warns on reload
   * only; the in-app guard stays quiet.
   */
  reloadLoses: boolean
}

export type IdFactory = () => string

export function initialWorkspace(): WorkspaceState {
  return { page: { kind: 'labels' }, unpersisted: false, reloadLoses: false }
}

/**
 * Go to a page.
 *
 * A new label gets a draft id here if it did not arrive with one, so that
 * the address can carry it and a reload finds the same draft. The
 * `unpersisted` flag is cleared: the editor that set it has unmounted and
 * flushed, and a new page starts clean.
 */
export function openPage(
  state: WorkspaceState,
  descriptor: PageDescriptor,
  nextDraftId: IdFactory = randomId,
): WorkspaceState {
  const isNewLabel = descriptor.kind === 'label' && (descriptor.templateId ?? null) === null
  const page: PageDescriptor = isNewLabel
    ? { ...descriptor, templateId: null, draftId: descriptor.draftId ?? nextDraftId() }
    : descriptor
  void state
  return { page, unpersisted: false, reloadLoses: false }
}

/**
 * Returns the state **unchanged** when the flag already has that value.
 *
 * Not an optimisation. A page that reports this from an effect sees the new
 * state object come back, re-runs the effect, and reports again — a render
 * loop. Identity is the only thing that stops it.
 */
export function markUnpersisted(state: WorkspaceState, unpersisted: boolean): WorkspaceState {
  return state.unpersisted === unpersisted ? state : { ...state, unpersisted }
}

export function markReloadLoses(state: WorkspaceState, reloadLoses: boolean): WorkspaceState {
  return state.reloadLoses === reloadLoses ? state : { ...state, reloadLoses }
}

/** Whether switching pages would discard work — the gate for the in-app guard. */
export function hasUnsavedWork(state: WorkspaceState): boolean {
  return state.unpersisted
}

/** Whether a reload would discard work — the gate for the browser's prompt. */
export function reloadWouldLose(state: WorkspaceState): boolean {
  return state.unpersisted || state.reloadLoses
}

/**
 * Rebuild the workspace after a reload, or on back/forward.
 *
 * An unrecognised address lands on the gallery rather than on nothing.
 */
export function restoreFromPath(address: string, nextDraftId: IdFactory = randomId): WorkspaceState {
  const descriptor = pageFromPath(address) ?? { kind: 'labels' as const }
  return openPage(initialWorkspace(), descriptor, nextDraftId)
}
