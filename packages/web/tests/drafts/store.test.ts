/**
 * The draft store: what it writes, what it reads back, and what it does when
 * the browser refuses.
 *
 * Everything runs against an in-memory storage with an injected clock and
 * window id, so a test says exactly which timestamp and which writer a draft
 * carries. The quota cases matter most: `localStorage` throws from `setItem`
 * with nothing stored, and the store's job is to turn that into "kept the
 * content, lost the history" before it becomes "lost everything".
 */
import { describe, expect, it } from 'vitest'
import { createDraftStore } from '../../src/features/drafts/store.ts'
import { DRAFT_PREFIX, memoryDraftStorage, type DraftStorage } from '../../src/features/drafts/storage.ts'
import { CLOCK, WINDOW, draftInput, failingStorage, ir } from './support.ts'

const make = (storage: DraftStorage = memoryDraftStorage(), clock = () => CLOCK, window = WINDOW) => ({
  storage,
  store: createDraftStore(storage, clock, window),
})

describe('writing and reading', () => {
  it('reads back what it wrote, stamped with the clock and the window', () => {
    const { store } = make()
    expect(store.write(draftInput())).toBe('stored')
    const draft = store.read('tpl-1')
    expect(draft).toMatchObject({ draftId: 'tpl-1', updatedAt: CLOCK, writerId: WINDOW, createdAt: CLOCK })
    expect(draft && 'present' in draft ? draft.present : null).toEqual(ir())
  })

  it('keeps the original createdAt across rewrites', () => {
    let now = '2026-09-21T10:00:00.000Z'
    const { store } = make(memoryDraftStorage(), () => now)
    store.write(draftInput())
    now = '2026-09-22T10:00:00.000Z'
    store.write(draftInput({ present: ir(5) }))
    const draft = store.read('tpl-1')
    expect(draft).toMatchObject({ createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z' })
  })

  it('returns null for a draft that was never written', () => {
    expect(make().store.read('nope')).toBeNull()
  })

  it('lists what it holds, with the label size for the gallery', () => {
    const { store } = make()
    store.write(draftInput())
    store.write(draftInput({ draftId: 'd-2', templateId: null, baseVersion: null, name: '试打' }))
    const { entries, corrupt } = store.list()
    expect(corrupt).toEqual([])
    expect(entries.map((e) => e.draftId).sort()).toEqual(['d-2', 'tpl-1'])
    expect(entries.find((e) => e.draftId === 'd-2')).toMatchObject({ name: '试打', widthMm: 50, heightMm: 30 })
  })

  it('removes a draft and its index entry together', () => {
    const { store } = make()
    store.write(draftInput())
    store.remove('tpl-1')
    expect(store.read('tpl-1')).toBeNull()
    expect(store.list().entries).toEqual([])
  })

  it('does not expire anything, however old', () => {
    // FR-021: there is no TTL. A draft written 400 days ago is still listed
    // by a store whose clock says today.
    const storage = memoryDraftStorage()
    createDraftStore(storage, () => '2025-08-01T00:00:00.000Z', WINDOW).write(draftInput())
    const today = createDraftStore(storage, () => '2026-09-21T00:00:00.000Z', WINDOW)
    expect(today.list().entries).toHaveLength(1)
    expect(today.read('tpl-1')).toMatchObject({ createdAt: '2025-08-01T00:00:00.000Z' })
  })
})

describe('the index heals itself', () => {
  it('drops an entry whose draft is gone', () => {
    const { store, storage } = make()
    store.write(draftInput())
    storage.removeItem(`${DRAFT_PREFIX}d.tpl-1`)
    expect(store.list().entries).toEqual([])
  })

  it('adds a draft the index does not know about', () => {
    const { store, storage } = make()
    store.write(draftInput())
    storage.removeItem(`${DRAFT_PREFIX}index`)
    expect(store.list().entries.map((e) => e.draftId)).toEqual(['tpl-1'])
  })
})

describe('corruption', () => {
  it('reports a draft that does not parse, without throwing', () => {
    const { store, storage } = make()
    storage.setItem(`${DRAFT_PREFIX}d.bad`, '{not json')
    expect(store.read('bad')).toEqual({ corrupt: true, draftId: 'bad' })
    expect(store.list().corrupt).toEqual(['bad'])
  })

  it('reports a draft that parses but fails the schema', () => {
    const { store, storage } = make()
    storage.setItem(`${DRAFT_PREFIX}d.bad`, JSON.stringify({ draftId: 'bad', present: {} }))
    expect(store.read('bad')).toEqual({ corrupt: true, draftId: 'bad' })
  })
})

describe('when storage is full', () => {
  it('drops the history and keeps the content', () => {
    const storage = failingStorage(1)
    const { store } = make(storage)
    expect(store.write(draftInput({ past: [ir(1), ir(2)] }))).toBe('stored-without-history')
    const draft = store.read('tpl-1')
    expect(draft && 'past' in draft ? draft.past : null).toEqual([])
    expect(draft && 'present' in draft ? draft.present : null).toEqual(ir())
  })

  it('gives up honestly when even the content will not fit', () => {
    const storage = failingStorage(5)
    const { store } = make(storage)
    expect(store.write(draftInput())).toBe('unpersisted')
    expect(store.read('tpl-1')).toBeNull()
  })

  it('never throws', () => {
    const { store } = make(failingStorage(99))
    expect(() => store.write(draftInput())).not.toThrow()
  })
})

describe('clear', () => {
  it('removes every draft and nothing else', () => {
    const storage = memoryDraftStorage()
    storage.setItem('zenith.preferences', '{"language":"zh-CN"}')
    const { store } = make(storage)
    store.write(draftInput())
    store.write(draftInput({ draftId: 'd-2', templateId: null, baseVersion: null }))
    store.clear()
    expect(store.list().entries).toEqual([])
    expect(storage.getItem('zenith.preferences')).toBe('{"language":"zh-CN"}')
  })
})
