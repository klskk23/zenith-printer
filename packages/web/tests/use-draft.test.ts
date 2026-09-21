/**
 * When a draft gets written.
 *
 * Every keystroke changes the editor's state, and serialising a label on
 * every one would make typing stutter. So writes are debounced — the last
 * change wins after a pause — and *flushed* at the moments a pause is not
 * coming: the page is hidden, the tab is closing, the person clicked the
 * sidebar. The scheduler is the pure core of that; the hook just wires the
 * browser events to it.
 */
import { describe, expect, it, vi } from 'vitest'
import { createWriteScheduler } from '../src/features/drafts/use-draft.tsx'
import { createDraftStore } from '../src/features/drafts/store.ts'
import { memoryDraftStorage, type DraftStorage } from '../src/features/drafts/storage.ts'
import { CLOCK, WINDOW, draftInput, failingStorage, ir } from './drafts/support.ts'

function fakeTimers(): { timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void }; run: () => void } {
  const queue = new Map<number, () => void>()
  let n = 0
  return {
    timers: {
      set: (fn, _ms) => {
        n += 1
        queue.set(n, fn)
        return n
      },
      clear: (id) => void queue.delete(id),
    },
    run: () => {
      const fns = [...queue.values()]
      queue.clear()
      fns.forEach((fn) => fn())
    },
  }
}

const storeOn = (storage: DraftStorage = memoryDraftStorage()) => createDraftStore(storage, () => CLOCK, WINDOW)

describe('createWriteScheduler', () => {
  it('writes once after a burst of changes, and the last one wins', () => {
    const store = storeOn()
    const { timers, run } = fakeTimers()
    const outcomes: string[] = []
    const scheduler = createWriteScheduler(store, 300, timers, (o) => outcomes.push(o))

    scheduler.schedule(draftInput({ present: ir(1) }))
    scheduler.schedule(draftInput({ present: ir(2) }))
    scheduler.schedule(draftInput({ present: ir(3) }))
    expect(store.read('tpl-1')).toBeNull()

    run()
    const draft = store.read('tpl-1')
    expect(draft && 'present' in draft ? draft.present : null).toEqual(ir(3))
    expect(outcomes).toEqual(['stored'])
  })

  it('flushes immediately on demand', () => {
    const store = storeOn()
    const { timers } = fakeTimers()
    const scheduler = createWriteScheduler(store, 300, timers, () => undefined)
    scheduler.schedule(draftInput())
    expect(scheduler.flush()).toBe('stored')
    expect(store.read('tpl-1')).not.toBeNull()
  })

  it('reports nothing to flush when nothing is pending', () => {
    const scheduler = createWriteScheduler(storeOn(), 300, fakeTimers().timers, () => undefined)
    expect(scheduler.flush()).toBeNull()
  })

  it('does not write twice for one change', () => {
    const storage = memoryDraftStorage()
    const store = storeOn(storage)
    const write = vi.spyOn(store, 'write')
    const { timers, run } = fakeTimers()
    const scheduler = createWriteScheduler(store, 300, timers, () => undefined)
    scheduler.schedule(draftInput())
    scheduler.flush()
    run()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('passes the store\'s verdict through', () => {
    const scheduler = createWriteScheduler(storeOn(failingStorage(99)), 300, fakeTimers().timers, () => undefined)
    scheduler.schedule(draftInput())
    expect(scheduler.flush()).toBe('unpersisted')
  })

  it('can be cancelled', () => {
    const store = storeOn()
    const { timers, run } = fakeTimers()
    const scheduler = createWriteScheduler(store, 300, timers, () => undefined)
    scheduler.schedule(draftInput())
    scheduler.cancel()
    run()
    expect(store.read('tpl-1')).toBeNull()
  })
})
