/**
 * React binding over the workspace reducer.
 *
 * The reducer in `workspace-state.ts` holds the rules; this file only connects
 * them to React and to the address bar. Keeping it this thin is deliberate —
 * the property that inactive tabs survive is easy to break by accident inside a
 * component tree, and impossible to break in a reducer that only ever adds to
 * or removes from a list.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../i18n/index.ts'
import { pathForTab, type TabDescriptor } from './routes.ts'
import {
  activateTab,
  closeTab,
  emptyWorkspace,
  editingTabCount,
  exceedsSoftLimit,
  hasUnsavedWork,
  markDirty,
  openTab,
  restoreFromPath,
  setTabTemplate,
  type WorkspaceState,
  type WorkspaceTab,
} from './workspace-state.ts'

export interface WorkspaceApi {
  state: WorkspaceState
  tabs: readonly WorkspaceTab[]
  activeTab: WorkspaceTab | null
  open: (descriptor: TabDescriptor) => void
  activate: (id: string) => void
  close: (id: string) => void
  setDirty: (id: string, isDirty: boolean) => void
  /** Bind a tab to a template — used the first time a design is saved. */
  setTemplate: (id: string, templateId: string | null) => void
  /** True once the tab count reaches the soft limit; advice only. */
  atSoftLimit: boolean
  /** How many editing tabs are open, for the warning to state plainly. */
  editingTabs: number
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null)

function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const counter = useRef(0)
  const nextId = useCallback(() => `tab-${(counter.current += 1)}`, [])

  // One tab is restored: the one the address names. The rest are gone, which
  // the leave prompt warned about before the reload happened.
  const [state, setState] = useState<WorkspaceState>(() => restoreFromPath(currentPath(), nextId))

  const open = useCallback(
    (descriptor: TabDescriptor) => setState((s) => openTab(s, descriptor, nextId)),
    [nextId],
  )
  const activate = useCallback((id: string) => setState((s) => activateTab(s, id)), [])
  const close = useCallback((id: string) => setState((s) => closeTab(s, id)), [])
  const setDirty = useCallback(
    (id: string, isDirty: boolean) => setState((s) => markDirty(s, id, isDirty)),
    [],
  )
  const setTemplate = useCallback(
    (id: string, templateId: string | null) => setState((s) => setTabTemplate(s, id, templateId)),
    [],
  )

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeId) ?? null,
    [state],
  )

  // The address follows the active tab. It never drives which tabs exist —
  // that is what would unmount the inactive ones.
  useEffect(() => {
    if (activeTab === null || typeof window === 'undefined') {
      return
    }
    const path = pathForTab({ kind: activeTab.kind, templateId: activeTab.templateId })
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
  }, [activeTab])

  // Back and forward move the active tab, opening one if the address names a
  // tab that is not currently in the set.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const onPop = (): void => {
      setState((s) => {
        const restored = restoreFromPath(window.location.pathname, nextId)
        const wanted = restored.tabs[0]
        if (wanted === undefined) {
          return s
        }
        const existing = s.tabs.find(
          (tab) => tab.kind === wanted.kind && tab.templateId === wanted.templateId,
        )
        return existing === undefined
          ? openTab(s, { kind: wanted.kind, templateId: wanted.templateId, dataSourceId: wanted.dataSourceId }, nextId)
          : activateTab(s, existing.id)
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [nextId])

  // Leaving with unsaved edits gets one prompt. Browsers show their own wording;
  // ours is set anyway for the few that still honour it.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedWork(state)) {
        return
      }
      event.preventDefault()
      event.returnValue = copy.workspace.leavePrompt
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      tabs: state.tabs,
      activeTab,
      open,
      activate,
      close,
      setDirty,
      setTemplate,
      atSoftLimit: exceedsSoftLimit(state),
      editingTabs: editingTabCount(state),
    }),
    [state, activeTab, open, activate, close, setDirty, setTemplate],
  )

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext)
  if (api === null) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  }
  return api
}

export function emptyWorkspaceState(): WorkspaceState {
  return emptyWorkspace()
}
