/**
 * The tab set — this application's real view state.
 *
 * Kept as a pure reducer rather than component state so the rules that matter
 * can be asserted without rendering anything, and so that nothing in the render
 * tree is in a position to quietly drop a tab.
 *
 * The property everything else depends on: **an inactive tab is still there**.
 * Its editing state, zoom and undo history survive because the tab object
 * survives. Anything that unmounts inactive tabs breaks the promise that
 * switching away and back costs nothing.
 */
import { isSingletonKind, tabFromPath, type TabDescriptor, type TabKind } from './routes.ts'

/**
 * Advice, not a gate. Every open tab keeps a full editing state resident, so
 * ten of them is where it is worth saying so — but refusing the eleventh would
 * block someone whose labels are small and whose machine is fine.
 */
export const SOFT_TAB_LIMIT = 10

export interface WorkspaceTab {
  id: string
  kind: TabKind
  /** Designs only; `null` is an unsaved blank design. */
  templateId: string | null
  /** Data source editor only. */
  dataSourceId?: string
  isDirty: boolean
}

export interface WorkspaceState {
  tabs: readonly WorkspaceTab[]
  activeId: string | null
}

export type IdFactory = () => string

export function emptyWorkspace(): WorkspaceState {
  return { tabs: [], activeId: null }
}

function findSingleton(state: WorkspaceState, kind: TabKind): WorkspaceTab | undefined {
  return isSingletonKind(kind) ? state.tabs.find((tab) => tab.kind === kind) : undefined
}

/**
 * Open a tab, or switch to it when the kind exists at most once.
 *
 * Designs are exempt: two design tabs on the same template is a normal way to
 * compare variants. The save conflict that can follow is handled where it
 * happens rather than prevented here.
 */
export function openTab(
  state: WorkspaceState,
  descriptor: TabDescriptor,
  nextId: IdFactory,
): WorkspaceState {
  const existing = findSingleton(state, descriptor.kind)
  if (existing !== undefined) {
    return { ...state, activeId: existing.id }
  }

  // A data source editor is per-table, like a design is per-template: opening
  // the same one twice should return to it rather than stack another tab.
  if (descriptor.kind === 'data-source') {
    const open = state.tabs.find(
      (tab) => tab.kind === 'data-source' && tab.dataSourceId === descriptor.dataSourceId,
    )
    if (open !== undefined) {
      return { ...state, activeId: open.id }
    }
  }

  const tab: WorkspaceTab = {
    id: nextId(),
    kind: descriptor.kind,
    templateId: descriptor.templateId ?? null,
    ...(descriptor.dataSourceId === undefined ? {} : { dataSourceId: descriptor.dataSourceId }),
    isDirty: false,
  }
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

/** Activating a tab that is not open is a no-op, not an error. */
export function activateTab(state: WorkspaceState, id: string): WorkspaceState {
  if (!state.tabs.some((tab) => tab.id === id)) {
    return state
  }
  return { ...state, activeId: id }
}

/** Closing the active tab falls back to its left neighbour, then its right. */
export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) {
    return state
  }

  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (state.activeId !== id) {
    return { ...state, tabs }
  }

  const neighbour = tabs[index - 1] ?? tabs[index] ?? null
  return { tabs, activeId: neighbour?.id ?? null }
}

/**
 * Point a tab at a template.
 *
 * Used when an unsaved design is first saved: the tab it lives in becomes that
 * template's tab, so its title, its address and any later save all refer to the
 * same thing.
 */
export function setTabTemplate(
  state: WorkspaceState,
  id: string,
  templateId: string | null,
): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, templateId } : tab)),
  }
}

export function markDirty(state: WorkspaceState, id: string, isDirty: boolean): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, isDirty } : tab)),
  }
}

export function exceedsSoftLimit(state: WorkspaceState): boolean {
  return state.tabs.length >= SOFT_TAB_LIMIT
}

/** Whether leaving the page would discard work — the gate for the leave prompt. */
export function hasUnsavedWork(state: WorkspaceState): boolean {
  return state.tabs.some((tab) => tab.isDirty)
}

/**
 * Rebuild the workspace after a reload.
 *
 * An address names exactly one tab, so exactly one is restored; the rest are
 * gone, which the leave prompt has already warned about. An unrecognised
 * address lands on the index rather than an empty workspace.
 */
export function restoreFromPath(path: string, nextId: IdFactory): WorkspaceState {
  const descriptor = tabFromPath(path) ?? { kind: 'index' as const }
  return openTab(emptyWorkspace(), descriptor, nextId)
}
