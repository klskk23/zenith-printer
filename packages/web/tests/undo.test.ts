/**
 * Undo.
 *
 * Covers every edit, not just the one requirement that named it. Deleting an
 * element is a single unconfirmed right-click away, so undo is the safety net
 * that makes that acceptable.
 */
import { describe, expect, it } from 'vitest'
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import {
  UNDO_LIMIT,
  canRedo,
  canUndo,
  commit,
  initUndo,
  redo,
  undo,
} from '../src/editor/undo.ts'

function ir(over: Partial<{ widthMm: number; elements: unknown[] }> = {}): LabelIR {
  return labelIrSchema.parse({
    widthMm: over.widthMm ?? 50,
    heightMm: 30,
    dpi: 203,
    elements: over.elements ?? [
      { id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 2 },
    ],
  })
}

const move = (base: LabelIR, xMm: number): LabelIR =>
  labelIrSchema.parse({ ...base, elements: [{ ...base.elements[0], xMm }] })

describe('the basic cycle', () => {
  it('starts with nothing to undo', () => {
    const state = initUndo(ir())
    expect(canUndo(state)).toBe(false)
    expect(canRedo(state)).toBe(false)
  })

  it('restores the previous state', () => {
    const first = ir()
    const state = commit(initUndo(first), move(first, 9))
    expect(undo(state).present).toBe(first)
  })

  it('redoes what was undone', () => {
    const first = ir()
    const second = move(first, 9)
    const state = commit(initUndo(first), second)
    expect(redo(undo(state)).present).toBe(second)
  })

  it('drops the redo branch once a new edit lands', () => {
    const first = ir()
    const state = commit(initUndo(first), move(first, 9))
    const branched = commit(undo(state), move(first, 20))
    expect(canRedo(branched)).toBe(false)
  })

  it('is a no-op at either end', () => {
    const state = initUndo(ir())
    expect(undo(state)).toBe(state)
    expect(redo(state)).toBe(state)
  })
})

/**
 * FR-086: every operation, not a selected few. Whole-IR snapshots make this
 * automatic — there is no per-operation inverse to forget to write.
 */
describe('coverage of edit kinds', () => {
  const base = ir()

  it.each([
    ['move', () => move(base, 12)],
    ['resize', () => labelIrSchema.parse({ ...base, elements: [{ ...base.elements[0], widthMm: 33 }] })],
    ['rotate', () => labelIrSchema.parse({ ...base, elements: [{ ...base.elements[0], rotation: 90 }] })],
    ['add', () => labelIrSchema.parse({ ...base, elements: [...base.elements, { id: 'e2', type: 'ellipse', xMm: 1, yMm: 1, widthMm: 5, heightMm: 5, strokeWidthDots: 1 }] })],
    ['delete', () => labelIrSchema.parse({ ...base, elements: [] })],
    ['property', () => labelIrSchema.parse({ ...base, elements: [{ ...base.elements[0], filled: true }] })],
    ['canvas size', () => ir({ widthMm: 40 })],
  ])('undoes a %s', (_label, makeNext) => {
    const state = commit(initUndo(base), makeNext())
    expect(undo(state).present).toBe(base)
  })
})

/**
 * What counts as one action.
 *
 * Both cases here were reported as undo being broken. A drag emits a state per
 * pointer move, each snapped to the grid, so undo walked back one grid step at
 * a time. Typing emits a state per keystroke, so undo deleted one character at
 * a time and a long field pushed everything else out of the fifty-entry
 * history.
 */
describe('actions', () => {
  it('records a drag as one step, not one per frame', () => {
    const first = ir()
    let state = initUndo(first)
    for (const x of [3, 4, 5, 6, 7, 8]) {
      state = commit(state, move(first, x), 'gesture-1')
    }

    expect(state.past).toHaveLength(1)
    expect(undo(state).present).toBe(first)
  })

  it('records typing in one field as one step', () => {
    const first = ir()
    let state = initUndo(first)
    for (const x of [1, 2, 3, 4]) {
      state = commit(state, move(first, x), 'text-1:content')
    }

    expect(state.past).toHaveLength(1)
    expect(undo(state).present).toBe(first)
  })

  it('keeps two consecutive drags apart', () => {
    // The editor mints a fresh key per gesture, so dragging an element twice
    // is two things done and two things to undo.
    const first = ir()
    let state = commit(initUndo(first), move(first, 3), 'gesture-1')
    state = commit(state, move(first, 9), 'gesture-2')
    expect(state.past).toHaveLength(2)
  })

  it('keeps two different fields apart', () => {
    const first = ir()
    let state = commit(initUndo(first), move(first, 3), 'text-1:content')
    state = commit(state, move(first, 9), 'text-1:fontSizeMm')
    expect(state.past).toHaveLength(2)
  })

  it('keeps the same field on two different elements apart', () => {
    const first = ir()
    let state = commit(initUndo(first), move(first, 3), 'text-1:content')
    state = commit(state, move(first, 9), 'text-2:content')
    expect(state.past).toHaveLength(2)
  })

  it('never merges an unnamed change', () => {
    // Most edits are single acts — bringing an element forward, deleting one.
    const first = ir()
    let state = commit(initUndo(first), move(first, 3))
    state = commit(state, move(first, 4))
    expect(state.past).toHaveLength(2)
  })

  it('does not merge into an empty history', () => {
    const first = ir()
    const state = commit(initUndo(first), move(first, 3), 'gesture-1')
    expect(canUndo(state)).toBe(true)
  })

  /**
   * Undoing ends whatever was in progress: typing again after an undo starts a
   * new entry rather than folding into the one just restored, which would make
   * the undo unrepeatable.
   */
  it('ends the action being undone', () => {
    const first = ir()
    let state = commit(initUndo(first), move(first, 3), 'text-1:content')
    state = commit(state, move(first, 4), 'text-1:content')
    expect(state.past).toHaveLength(1)

    state = undo(state)
    state = commit(state, move(first, 9), 'text-1:content')
    expect(state.past).toHaveLength(1)
    expect(undo(state).present).toBe(first)
  })

  it('ends the action after a redo, too', () => {
    const first = ir()
    let state = commit(initUndo(first), move(first, 3), 'text-1:content')
    state = redo(undo(state))
    state = commit(state, move(first, 4), 'text-1:content')
    expect(state.past).toHaveLength(2)
  })
})

describe('depth', () => {
  it('keeps at most the configured number of steps', () => {
    const first = ir()
    let state = initUndo(first)
    for (let i = 1; i <= UNDO_LIMIT + 20; i += 1) {
      state = commit(state, move(first, i))
    }
    expect(state.past).toHaveLength(UNDO_LIMIT)
  })

  it('discards the oldest, not the newest', () => {
    const first = ir()
    let state = initUndo(first)
    for (let i = 1; i <= UNDO_LIMIT + 5; i += 1) {
      state = commit(state, move(first, i))
    }
    // The very first state has fallen off the end.
    expect(state.past).not.toContain(first)
  })
})

/** FR-087 / FR-088: per tab, and gone when the tab is. */
describe('scope', () => {
  it('keeps two histories independent', () => {
    const a0 = ir()
    const b0 = ir({ widthMm: 40 })
    const a = commit(initUndo(a0), move(a0, 9))
    const b = initUndo(b0)

    expect(canUndo(a)).toBe(true)
    expect(canUndo(b)).toBe(false)
    expect(undo(a).present).toBe(a0)
    expect(b.present).toBe(b0)
  })

  it('starts empty for a freshly opened tab', () => {
    // Nothing is loaded from storage: closing a tab discards its history, so
    // reopening the same template offers nothing to undo.
    const reopened = initUndo(ir())
    expect(canUndo(reopened)).toBe(false)
    expect(canRedo(reopened)).toBe(false)
    expect(reopened.past).toEqual([])
  })
})
