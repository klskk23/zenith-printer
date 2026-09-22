/**
 * The workspace: which page is open, and whether leaving it would lose work.
 *
 * This used to be a set of tabs whose promise was that an inactive tab kept
 * its editing state. The design settled on the opposite rule: **leaving is
 * abandoning**. An editor's unsaved edits exist only while it is open; going
 * anywhere else asks first and then discards them. So the state is one page
 * and one flag, and the flag gates the question.
 */
import { isLabelKind, pageFromPath, type PageDescriptor } from './routes.ts'

export interface WorkspaceState {
  page: PageDescriptor
  /** The open page holds unsaved edits: leaving asks first. */
  dirty: boolean
}

export function initialWorkspace(): WorkspaceState {
  return { page: { kind: 'labels' }, dirty: false }
}

/**
 * Go to a page. The flag is cleared: whatever was unsaved on the previous
 * page is gone with it, which is what the person confirmed.
 */
export function openPage(state: WorkspaceState, descriptor: PageDescriptor): WorkspaceState {
  const page: PageDescriptor =
    isLabelKind(descriptor.kind) ? { ...descriptor, templateId: descriptor.templateId ?? null } : descriptor
  // Stepping within one label keeps the flag: the content is still open and
  // still unsaved, and the question has to survive as far as the way out.
  const stepping =
    isLabelKind(page.kind) &&
    isLabelKind(state.page.kind) &&
    (page.templateId ?? null) === (state.page.templateId ?? null)
  return { page, dirty: stepping ? state.dirty : false }
}

/**
 * Returns the state **unchanged** when the flag already has that value.
 *
 * Not an optimisation. A page that reports this from an effect sees the new
 * state object come back, re-runs the effect, and reports again — a render
 * loop. Identity is the only thing that stops it.
 */
export function markDirty(state: WorkspaceState, dirty: boolean): WorkspaceState {
  return state.dirty === dirty ? state : { ...state, dirty }
}

/** Whether leaving the page — by navigation or by reload — would discard work. */
export function hasUnsavedWork(state: WorkspaceState): boolean {
  return state.dirty
}

/**
 * Rebuild the workspace after a reload, or on back/forward.
 *
 * An unrecognised address lands on the gallery rather than on nothing.
 */
export function restoreFromPath(address: string): WorkspaceState {
  const descriptor = pageFromPath(address) ?? { kind: 'labels' as const }
  return openPage(initialWorkspace(), descriptor)
}
