/**
 * The tab set.
 *
 * This is the application's real view state; the address bar only names which
 * of these is showing. Modelled as a pure reducer so the rules that matter —
 * nothing gets unmounted, nothing gets silently replaced — can be asserted
 * without rendering anything.
 */
import { describe, expect, it } from 'vitest'
import {
  SOFT_TAB_LIMIT,
  activateTab,
  closeTab,
  emptyWorkspace,
  exceedsSoftLimit,
  markDirty,
  openTab,
  restoreFromPath,
  type WorkspaceState,
} from '../src/app/workspace-state.ts'

/** Deterministic ids keep the assertions readable. */
function ids(): () => string {
  let n = 0
  return () => `tab-${(n += 1)}`
}

function open(state: WorkspaceState, descriptor: Parameters<typeof openTab>[1], nextId = ids()): WorkspaceState {
  return openTab(state, descriptor, nextId)
}

describe('opening tabs', () => {
  it('starts empty', () => {
    expect(emptyWorkspace().tabs).toEqual([])
    expect(emptyWorkspace().activeId).toBeNull()
  })

  it('opens a tab and activates it', () => {
    const state = open(emptyWorkspace(), { kind: 'printers' })
    expect(state.tabs).toHaveLength(1)
    expect(state.activeId).toBe(state.tabs[0]!.id)
  })

  it('switches to an already-open singleton rather than duplicating it', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'printers' }, next)
    state = open(state, { kind: 'queue' }, next)
    state = open(state, { kind: 'printers' }, next)

    expect(state.tabs.filter((t) => t.kind === 'printers')).toHaveLength(1)
    expect(state.tabs.find((t) => t.id === state.activeId)?.kind).toBe('printers')
  })

  it('allows several design tabs at once', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'design', templateId: null }, next)
    state = open(state, { kind: 'design', templateId: null }, next)

    expect(state.tabs).toHaveLength(2)
    expect(new Set(state.tabs.map((t) => t.id)).size).toBe(2)
  })

  it('allows the same template to be opened twice', () => {
    // Deliberate: the spec handles the resulting save conflict rather than
    // preventing the situation, because one person with two tabs is a normal
    // way to compare two variants of a label.
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'design', templateId: 'tpl-1' }, next)
    state = open(state, { kind: 'design', templateId: 'tpl-1' }, next)
    expect(state.tabs).toHaveLength(2)
  })
})

describe('view state is preserved across switches', () => {
  it('keeps every tab in the set when another is activated', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'design', templateId: null }, next)
    const first = state.tabs[0]!.id
    state = open(state, { kind: 'printers' }, next)

    expect(state.activeId).not.toBe(first)
    // The crucial property: activating another tab must not remove this one.
    expect(state.tabs.map((t) => t.id)).toContain(first)
  })

  it('restores the same tab object when switching back', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'design', templateId: null }, next)
    const first = state.tabs[0]!
    state = open(state, { kind: 'settings' }, next)
    state = activateTab(state, first.id)

    expect(state.tabs.find((t) => t.id === first.id)).toBe(first)
    expect(state.activeId).toBe(first.id)
  })

  it('ignores activation of a tab that is not open', () => {
    const state = open(emptyWorkspace(), { kind: 'index' })
    expect(activateTab(state, 'missing')).toBe(state)
  })
})

describe('closing tabs', () => {
  it('removes the tab', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'index' }, next)
    state = open(state, { kind: 'printers' }, next)
    const target = state.activeId!
    state = closeTab(state, target)

    expect(state.tabs.map((t) => t.id)).not.toContain(target)
  })

  it('activates a neighbour when the active tab closes', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'index' }, next)
    const first = state.tabs[0]!.id
    state = open(state, { kind: 'printers' }, next)
    state = closeTab(state, state.activeId!)

    expect(state.activeId).toBe(first)
  })

  it('leaves no active tab once the last one closes', () => {
    let state = open(emptyWorkspace(), { kind: 'index' })
    state = closeTab(state, state.activeId!)
    expect(state.tabs).toEqual([])
    expect(state.activeId).toBeNull()
  })

  it('keeps the active tab when a different one closes', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'index' }, next)
    const first = state.tabs[0]!.id
    state = open(state, { kind: 'printers' }, next)
    const active = state.activeId!
    state = closeTab(state, first)
    expect(state.activeId).toBe(active)
  })
})

describe('unsaved marker', () => {
  it('marks and clears a tab', () => {
    let state = open(emptyWorkspace(), { kind: 'design', templateId: null })
    const id = state.activeId!
    expect(state.tabs[0]!.isDirty).toBe(false)

    state = markDirty(state, id, true)
    expect(state.tabs[0]!.isDirty).toBe(true)

    state = markDirty(state, id, false)
    expect(state.tabs[0]!.isDirty).toBe(false)
  })

  it('reports whether anything is unsaved, which is what gates the leave prompt', () => {
    const next = ids()
    let state = open(emptyWorkspace(), { kind: 'design', templateId: null }, next)
    state = open(state, { kind: 'design', templateId: null }, next)
    expect(state.tabs.some((t) => t.isDirty)).toBe(false)

    state = markDirty(state, state.tabs[1]!.id, true)
    expect(state.tabs.some((t) => t.isDirty)).toBe(true)
  })
})

describe('soft tab limit', () => {
  it('warns at the limit but never refuses', () => {
    const next = ids()
    let state = emptyWorkspace()
    for (let i = 0; i < SOFT_TAB_LIMIT; i += 1) {
      state = open(state, { kind: 'design', templateId: null }, next)
    }
    expect(state.tabs).toHaveLength(SOFT_TAB_LIMIT)
    expect(exceedsSoftLimit(state)).toBe(true)

    // The point of a soft limit: it is advice, not a gate.
    state = open(state, { kind: 'design', templateId: null }, next)
    expect(state.tabs).toHaveLength(SOFT_TAB_LIMIT + 1)
  })

  it('stays quiet below the limit', () => {
    const next = ids()
    let state = emptyWorkspace()
    for (let i = 0; i < SOFT_TAB_LIMIT - 1; i += 1) {
      state = open(state, { kind: 'design', templateId: null }, next)
    }
    expect(exceedsSoftLimit(state)).toBe(false)
  })
})

describe('restoring after a refresh', () => {
  it('restores exactly the tab the address names, and nothing else', () => {
    const state = restoreFromPath('/printers', ids())
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]!.kind).toBe('printers')
    expect(state.activeId).toBe(state.tabs[0]!.id)
  })

  it('restores an unsaved design as a fresh blank one', () => {
    const state = restoreFromPath('/design/new', ids())
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({ kind: 'design', templateId: null, isDirty: false })
  })

  it('falls back to the index for an unknown address', () => {
    expect(restoreFromPath('/nope', ids()).tabs[0]!.kind).toBe('index')
  })
})
