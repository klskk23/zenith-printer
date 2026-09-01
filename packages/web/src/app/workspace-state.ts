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
 * Advice, not a gate. A design tab keeps a full editing state resident, so ten
 * of them is where it is worth saying so — but refusing the eleventh would
 * block someone whose labels are small and whose machine is fine.
 *
 * Counted over the editing kinds only: see `EDITING_KINDS`.
 */
export const SOFT_TAB_LIMIT = 10

export interface WorkspaceTab {
  id: string
  kind: TabKind
  /** Designs only; `null` is an unsaved blank design. */
  templateId: string | null
  /** Data source editor only. */
  dataSourceId?: string
  /**
   * Designs only: the print preset the tab was opened on, from `?preset=`.
   *
   * Held by the tab rather than read from the address when needed, because the
   * address is rewritten *from* the active tab — a preset the tab did not keep
   * would be erased by the first tab switch, and with it the only record of
   * why this design opened with a printer already chosen.
   */
  presetId?: string
  /**
   * Unsaved designs only: what separates 「未命名设计 1」 from 「未命名设计 2」.
   *
   * Assigned when the tab opens and never touched again, so closing one tab
   * cannot relabel the rest. See `nextDraftNumber`.
   */
  draftNumber?: number
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

function isUntitledDesign(tab: WorkspaceTab): boolean {
  return tab.kind === 'design' && tab.templateId === null
}

/**
 * The number a new blank design gets: the lowest one nobody is using.
 *
 * Two properties, and they pull in opposite directions:
 *
 *   - **Stable.** A number belongs to its tab for as long as that tab is
 *     unsaved. Deriving it from position instead would renumber 「未命名设计 3」
 *     to 「未命名设计 2」 the moment somebody closed a different tab — which is
 *     the confusion the numbers were added to end.
 *   - **Small.** Reusing the lowest free number keeps the strip readable;
 *     a counter that only ever climbs reaches 「未命名设计 17」 on a machine
 *     that has never had two open at once.
 *
 * Gaps are the price: with 1 and 3 open, the next one is 2, and closing 2
 * leaves 1 and 3. That is the honest reading — those two tabs did not change.
 */
function nextDraftNumber(tabs: readonly WorkspaceTab[]): number {
  const taken = new Set(tabs.filter(isUntitledDesign).map((tab) => tab.draftNumber))
  let candidate = 1
  while (taken.has(candidate)) {
    candidate += 1
  }
  return candidate
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

  const isBlankDesign = descriptor.kind === 'design' && (descriptor.templateId ?? null) === null
  const tab: WorkspaceTab = {
    id: nextId(),
    kind: descriptor.kind,
    templateId: descriptor.templateId ?? null,
    ...(descriptor.dataSourceId === undefined ? {} : { dataSourceId: descriptor.dataSourceId }),
    ...(descriptor.presetId === undefined ? {} : { presetId: descriptor.presetId }),
    ...(isBlankDesign ? { draftNumber: nextDraftNumber(state.tabs) } : {}),
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
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) {
        return tab
      }
      // The number goes with the title. Once the tab is called after a
      // template it is not holding one any more, so the next blank design gets
      // it back; were the tab ever pointed at nothing again it needs a fresh
      // one, since its old number may since have been handed out.
      const next: WorkspaceTab = { ...tab, templateId }
      if (templateId === null) {
        next.draftNumber = nextDraftNumber(state.tabs.filter((other) => other.id !== id))
      } else {
        delete next.draftNumber
      }
      return next
    }),
  }
}

/**
 * Returns the state **unchanged** when the flag already has that value.
 *
 * Not an optimisation. A page that reports its own dirtiness from an effect
 * sees the new state object come back, re-runs the effect, and reports again —
 * a render loop that hangs the tab. Identity is the only thing that stops it.
 */
export function markDirty(state: WorkspaceState, id: string, isDirty: boolean): WorkspaceState {
  if (!state.tabs.some((tab) => tab.id === id && tab.isDirty !== isDirty)) {
    return state
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, isDirty } : tab)),
  }
}

/**
 * The kinds whose tabs cost something to keep open.
 *
 * A design tab holds a live SVG editor and its undo history; the template
 * library holds a list and its thumbnails. The rest — printers, the queue,
 * history, settings — are single pages that fetch and render, and counting
 * them towards a warning about *editing* would make the advice fire for
 * reasons that have nothing to do with it.
 */
const EDITING_KINDS: ReadonlySet<TabKind> = new Set<TabKind>(['design', 'templates'])

/** How many open tabs are the kind the warning is about. */
export function editingTabCount(state: WorkspaceState): number {
  return state.tabs.filter((tab) => EDITING_KINDS.has(tab.kind)).length
}

export function exceedsSoftLimit(state: WorkspaceState): boolean {
  return editingTabCount(state) >= SOFT_TAB_LIMIT
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
export function restoreFromPath(address: string, nextId: IdFactory): WorkspaceState {
  // The whole address, query included: `?preset=` is part of where a link
  // meant to land.
  const descriptor = tabFromPath(address) ?? { kind: 'index' as const }
  return openTab(emptyWorkspace(), descriptor, nextId)
}
