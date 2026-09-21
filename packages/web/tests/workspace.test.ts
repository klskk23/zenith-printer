/**
 * The workspace: one page at a time, and whether leaving it would lose work.
 *
 * It used to be a set of tabs whose whole promise was that an inactive tab
 * kept its editing state. The design settled on the opposite: leaving is
 * abandoning, after one question. What is left is small and still worth
 * pinning — which page is open, and the flag that gates the question.
 */
import { describe, expect, it } from 'vitest'
import { hasUnsavedWork, initialWorkspace, markDirty, openPage, restoreFromPath } from '../src/app/workspace-state.ts'

describe('opening pages', () => {
  it('starts on the gallery', () => {
    expect(initialWorkspace().page).toEqual({ kind: 'labels' })
  })

  it('replaces the page rather than stacking one', () => {
    let state = openPage(initialWorkspace(), { kind: 'printers' })
    state = openPage(state, { kind: 'queue' })
    expect(state.page).toEqual({ kind: 'queue' })
  })

  it('opens a new label with no id', () => {
    expect(openPage(initialWorkspace(), { kind: 'label' }).page).toEqual({ kind: 'label', templateId: null })
  })

  it('carries a preset with the label', () => {
    const state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1', presetId: 'p' })
    expect(state.page).toMatchObject({ templateId: 'tpl-1', presetId: 'p' })
  })
})

describe('the leave question', () => {
  it('is asked only while the page has unsaved edits', () => {
    let state = openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' })
    expect(hasUnsavedWork(state)).toBe(false)
    state = markDirty(state, true)
    expect(hasUnsavedWork(state)).toBe(true)
    state = markDirty(state, false)
    expect(hasUnsavedWork(state)).toBe(false)
  })

  it('returns the same state when the flag is already right', () => {
    const state = initialWorkspace()
    expect(markDirty(state, false)).toBe(state)
  })

  it('forgets the flag when the page changes — leaving abandoned the edits', () => {
    let state = markDirty(openPage(initialWorkspace(), { kind: 'label', templateId: 'tpl-1' }), true)
    state = openPage(state, { kind: 'printers' })
    expect(hasUnsavedWork(state)).toBe(false)
  })
})

describe('restoring from an address', () => {
  it('restores the page the address names', () => {
    expect(restoreFromPath('/printers').page).toEqual({ kind: 'printers' })
  })

  it('restores a new label from either form of its address', () => {
    expect(restoreFromPath('/labels/new').page).toEqual({ kind: 'label', templateId: null })
    expect(restoreFromPath('/design').page).toEqual({ kind: 'label', templateId: null })
  })

  it('falls back to the gallery for an unknown address', () => {
    expect(restoreFromPath('/nope').page).toEqual({ kind: 'labels' })
  })
})
