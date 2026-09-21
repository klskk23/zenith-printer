/**
 * React binding over the workspace reducer.
 *
 * The reducer in `workspace-state.ts` holds the rules; this file only connects
 * them to React and to the address bar, and holds back a navigation while the
 * open page has unsaved edits so the shell can ask.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { copy } from '../i18n/index.ts'
import { isLegacyAddress, pathForPage, type PageDescriptor } from './routes.ts'
import { hasUnsavedWork, markDirty, openPage, restoreFromPath, type WorkspaceState } from './workspace-state.ts'

export interface WorkspaceApi {
  state: WorkspaceState
  page: PageDescriptor
  /**
   * Go to a page — unless the open page holds unsaved edits, in which case the
   * request is held and the shell asks first. Everything that navigates goes
   * through here, so the question cannot be skipped.
   */
  open: (descriptor: PageDescriptor) => void
  /** Whether the open page holds unsaved edits — see `hasUnsavedWork`. */
  setDirty: (dirty: boolean) => void
  /** A navigation held back by unsaved edits, waiting for an answer. */
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
  const setDirty = useCallback((dirty: boolean) => setState((s) => markDirty(s, dirty)), [])

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
    if (isLegacyAddress(current)) {
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

  // Leaving with unsaved edits gets one prompt. Browsers show their own wording;
  // ours is set anyway for the few that honour it.
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
    () => ({ state, page: state.page, open, setDirty, pendingLeave, confirmLeave, stay }),
    [state, open, setDirty, pendingLeave, confirmLeave, stay],
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
