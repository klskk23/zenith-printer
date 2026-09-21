/**
 * Drafts, from the editor's side.
 *
 * `createWriteScheduler` is the pure part: it debounces writes so typing does
 * not serialise a label per keystroke, and flushes on demand for the moments
 * a pause is not coming. `useDraft` wires that to a label and to the browser
 * events that mean "leaving": the page being hidden, the tab closing, the
 * component unmounting because the person clicked the sidebar.
 *
 * The store comes from context so a test can hand in a full or absent one;
 * the application uses the singleton in `./index.ts`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { draftStore as defaultStore, persistence as defaultPersistence, type Persistence } from './index.ts'
import type { Draft, DraftInput } from './schema.ts'
import { isCorrupt } from './schema.ts'
import type { DraftStore, WriteOutcome } from './store.ts'

export interface Timers {
  set: (fn: () => void, ms: number) => number
  clear: (id: number) => void
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
}

export interface WriteScheduler {
  /** Replace whatever is pending; the write happens after the delay. */
  schedule: (input: DraftInput) => void
  /** Write now. `null` when nothing was pending. */
  flush: () => WriteOutcome | null
  cancel: () => void
}

export function createWriteScheduler(
  store: DraftStore,
  delayMs: number,
  timers: Timers,
  onOutcome: (outcome: WriteOutcome) => void,
): WriteScheduler {
  let pending: DraftInput | null = null
  let timer: number | null = null

  const cancel = (): void => {
    if (timer !== null) {
      timers.clear(timer)
      timer = null
    }
    pending = null
  }

  const flush = (): WriteOutcome | null => {
    if (pending === null) {
      return null
    }
    const input = pending
    cancel()
    const outcome = store.write(input)
    onOutcome(outcome)
    return outcome
  }

  const schedule = (input: DraftInput): void => {
    pending = input
    if (timer !== null) {
      timers.clear(timer)
    }
    timer = timers.set(() => {
      timer = null
      flush()
    }, delayMs)
  }

  return { schedule, flush, cancel }
}

/** The debounce. Long enough to fold a burst of keystrokes, short enough that a stray click cannot outrun it. */
export const WRITE_DELAY_MS = 300

interface DraftsContextValue {
  store: DraftStore
  persistence: Persistence
}

const DraftsContext = createContext<DraftsContextValue>({ store: defaultStore, persistence: defaultPersistence })

export function DraftsProvider({
  store,
  persistence,
  children,
}: DraftsContextValue & { children: React.ReactNode }): React.JSX.Element {
  const value = useMemo(() => ({ store, persistence }), [store, persistence])
  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
}

export function useDrafts(): DraftsContextValue {
  return useContext(DraftsContext)
}

/** What the editor shows about the draft's fate. */
export type DraftStatus = 'stored' | 'stored-without-history' | 'unpersisted' | 'no-storage'

export interface UseDraft {
  /** The draft found for this key when it was first looked at; null when none. */
  initial: Draft | null
  /** Record the current state; written after a pause. */
  update: (input: Omit<DraftInput, 'draftId'>) => void
  /** Write now. */
  flush: () => void
  /** Forget the draft — after a successful save. */
  discard: () => void
  status: DraftStatus
}

export function useDraft(draftId: string): UseDraft {
  const { store, persistence } = useDrafts()
  const [status, setStatus] = useState<DraftStatus>(persistence === 'memory' ? 'no-storage' : 'stored')

  // Read once per key. A draft read on every render would race the writes.
  const initial = useMemo(() => {
    const found = store.read(draftId)
    return found === null || isCorrupt(found) ? null : found
  }, [store, draftId])

  const scheduler = useMemo(
    () =>
      createWriteScheduler(store, WRITE_DELAY_MS, browserTimers, (outcome) => {
        // In memory, every write "succeeds" and none survives a reload; the
        // status keeps saying so rather than reporting a comfort it cannot give.
        setStatus(persistence === 'memory' ? 'no-storage' : outcome)
      }),
    [store, persistence],
  )
  // The scheduler outlives the render that created it; a ref keeps the
  // unmount flush pointed at the live one.
  const schedulerRef = useRef(scheduler)
  schedulerRef.current = scheduler

  const update = useCallback(
    (input: Omit<DraftInput, 'draftId'>) => scheduler.schedule({ ...input, draftId }),
    [scheduler, draftId],
  )
  const flush = useCallback(() => void scheduler.flush(), [scheduler])
  const discard = useCallback(() => {
    scheduler.cancel()
    store.remove(draftId)
  }, [scheduler, store, draftId])

  // The moments a pause is not coming.
  useEffect(() => {
    const onHide = (): void => void schedulerRef.current.flush()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        onHide()
      }
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      // Unmount: the person navigated away, or the tab closed.
      schedulerRef.current.flush()
    }
  }, [])

  return { initial, update, flush, discard, status }
}
