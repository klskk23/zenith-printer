/**
 * React binding over the workspace reducer.
 *
 * The reducer in `workspace-state.ts` holds the rules; this file only connects
 * them to React and to the address bar. Leaving the editor flushes its draft
 * on unmount (features/drafts/use-draft.tsx), so navigating here needs no
 * ceremony — the page simply changes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../i18n/index.ts'
import { isLegacyAddress, pathForPage, type PageDescriptor } from './routes.ts'
import {
  hasUnsavedWork,
  markReloadLoses,
  markUnpersisted,
  openPage,
  reloadWouldLose,
  restoreFromPath,
  type WorkspaceState,
} from './workspace-state.ts'

export interface WorkspaceApi {
  state: WorkspaceState
  page: PageDescriptor
  /**
   * Go to a page — unless the open page holds work that would be lost, in
   * which case the request is held and the shell asks first. Everything that
   * navigates goes through here, so the question cannot be skipped.
   */
  open: (descriptor: PageDescriptor) => void
  /** Whether the open page holds work that leaving would lose — see `hasUnsavedWork`. */
  setUnpersisted: (unpersisted: boolean) => void
  /** Whether the open label's draft is in memory only — a reload loses it, a page switch does not. */
  setReloadLoses: (reloadLoses: boolean) => void
  /** A navigation held back by unsaved work, waiting for an answer. */
  pendingLeave: PageDescriptor | null
  confirmLeave: () => void
  stay: () => void
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null)

/** The whole address, query included: `?preset=` is part of where a link meant to land. */
function currentAddress(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<WorkspaceState>(() => restoreFromPath(currentAddress()))
  const [pendingLeave, setPendingLeave] = useState<PageDescriptor | null>(null)
  // Read by `open` without being a dependency of it, so the callback stays
  // stable and pages can depend on it without re-running their effects.
  const stateRef = useRef(state)
  stateRef.current = state

  const open = useCallback((descriptor: PageDescriptor) => {
    if (hasUnsavedWork(stateRef.current)) {
      setPendingLeave(descriptor)
      return
    }
    setState((s) => openPage(s, descriptor))
  }, [])
  const confirmLeave = useCallback(() => {
    const held = pendingLeave
    setPendingLeave(null)
    if (held !== null) {
      setState((s) => openPage(s, held))
    }
  }, [pendingLeave])
  const stay = useCallback(() => setPendingLeave(null), [])
  const setUnpersisted = useCallback(
    (unpersisted: boolean) => setState((s) => markUnpersisted(s, unpersisted)),
    [],
  )
  const setReloadLoses = useCallback(
    (reloadLoses: boolean) => setState((s) => markReloadLoses(s, reloadLoses)),
    [],
  )

  // The address follows the page. An old-form address is rewritten in place
  // rather than pushed, so Back does not return to the address that redirected.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const path = pathForPage(state.page)
    const current = currentAddress()
    if (current === path) {
      return
    }
    if (isLegacyAddress(current) || /^\/labels\/new$/.test(current)) {
      window.history.replaceState(null, '', path)
    } else {
      window.history.pushState(null, '', path)
    }
  }, [state.page])

  // Back and forward change the page.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const onPop = (): void => setState(restoreFromPath(currentAddress()))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Leaving with a draft that could not be written gets one prompt. Browsers
  // show their own wording; ours is set anyway for the few that honour it.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!reloadWouldLose(state)) {
        return
      }
      event.preventDefault()
      event.returnValue = copy.workspace.leavePrompt
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  const api = useMemo<WorkspaceApi>(
    () => ({ state, page: state.page, open, setUnpersisted, setReloadLoses, pendingLeave, confirmLeave, stay }),
    [state, open, setUnpersisted, setReloadLoses, pendingLeave, confirmLeave, stay],
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
