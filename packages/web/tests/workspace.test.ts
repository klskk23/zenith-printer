/**
 * The workspace: one page at a time.
 *
 * It used to be a set of tabs whose whole promise was that an inactive tab
 * kept its editing state. That promise moved into drafts (features/drafts),
 * and with it gone the set had no reason to exist. What is left is small and
 * still worth pinning: which page is open, whether a new label got a draft
 * id, and the one flag that still gates the browser's leave prompt.
 */
import { describe, expect, it } from 'vitest'
import {
  hasUnsavedWork,
  initialWorkspace,
  markReloadLoses,
  markUnpersisted,
  openPage,
  reloadWouldLose,
  restoreFromPath,
} from '../src/app/workspace-state.ts'

const ids = (): (() => string) => {
  let n = 0
  return () => `d-${(n += 1)}`
}

describe('opening pages', () => {
  it('starts on the gallery', () => {
    expect(initialWorkspace().page).toEqual({ kind: 'labels' })
  })

  it('replaces the page rather than stacking one', () => {
    let state = openPage(initialWorkspace(), { kind: 'printers' })
    state = openPage(state, { kind: 'queue' })
    expect(state.page).toEqual({ kind: 'queue' })
  })

  it('gives a new label a draft id of its own', () => {
    const state = openPage(initialWorkspace(), { kind: 'label', templateId: null }, ids())
    expect(state.page).toEqual({ kind: 'label', templateId: null, draftId: 'd-1' })
  })

  it('keeps a draft id it was handed', () => {
    const state = openPage(initialWorkspace(), { kind: 'label', templateId: null, draftId: 'd-kept' }, ids())
    expect(state.page).toMatchObject({ draftId: 'd-kept' })
  })

  it('gives a saved label no draft id', () => {
    const state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' }, ids())
    expect(state.page).toEqual({ kind: 'label', templateId: 'tpl-1' })
  })

  it('carries a preset with the label', () => {
    const state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1', presetId: 'p' })
    expect(state.page).toMatchObject({ presetId: 'p' })
  })
})

describe('the leave prompt', () => {
  it('is quiet until a draft fails to reach storage', () => {
    let state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' })
    expect(hasUnsavedWork(state)).toBe(false)
    state = markUnpersisted(state, true)
    expect(hasUnsavedWork(state)).toBe(true)
    state = markUnpersisted(state, false)
    expect(hasUnsavedWork(state)).toBe(false)
  })

  it('arms only the reload prompt for a draft held in memory', () => {
    // A page switch keeps an in-memory draft; only a reload loses it.
    let state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' })
    state = markReloadLoses(state, true)
    expect(hasUnsavedWork(state)).toBe(false)
    expect(reloadWouldLose(state)).toBe(true)
  })

  it('returns the same state when the flag is already right', () => {
    const state = initialWorkspace()
    expect(markUnpersisted(state, false)).toBe(state)
  })

  it('forgets the flag when the page changes', () => {
    // The editor that set it has unmounted and flushed; a new page starts clean.
    let state = markUnpersisted(openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' }), true)
    state = openPage(state, { kind: 'printers' })
    expect(hasUnsavedWork(state)).toBe(false)
  })
})

describe('restoring from an address', () => {
  it('restores the page the address names', () => {
    expect(restoreFromPath('/printers').page).toEqual({ kind: 'printers' })
  })

  it('takes a new label\'s draft id from the address', () => {
    expect(restoreFromPath('/labels/new/d-abc', ids()).page).toMatchObject({ kind: 'label', draftId: 'd-abc' })
  })

  it('mints one when the address has none', () => {
    expect(restoreFromPath('/design', ids()).page).toMatchObject({ kind: 'label', draftId: 'd-1' })
  })

  it('falls back to the gallery for an unknown address', () => {
    expect(restoreFromPath('/nope').page).toEqual({ kind: 'labels' })
  })
})
