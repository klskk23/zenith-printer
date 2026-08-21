/**
 * Undo history for one design tab.
 *
 * Whole-IR snapshots rather than per-operation inverses. A label is a handful
 * of elements, so the memory cost is trivial, and the alternative has a failure
 * mode worth avoiding: every new kind of edit needs its own inverse written,
 * and the one nobody remembers to write is the one that corrupts the design.
 * A snapshot needs nothing written per operation, so a new element type or a
 * new property is undoable the day it exists.
 *
 * Not persisted (FR-088). The history belongs to the tab; closing it discards
 * the history along with everything else about that tab.
 */
import type { LabelIR } from '@zenith/shared'

/** Deep enough for a work session, shallow enough to stay cheap. */
export const UNDO_LIMIT = 50

export interface UndoState {
  past: readonly LabelIR[]
  present: LabelIR
  future: readonly LabelIR[]
}

export function initUndo(present: LabelIR): UndoState {
  return { past: [], present, future: [] }
}

/**
 * Record a new state.
 *
 * `coalesce` merges this change into the previous entry instead of adding one.
 * A drag emits a state per pointer move; without merging, one drag fills the
 * entire history and undo stops meaning anything.
 */
export function commit(state: UndoState, next: LabelIR, coalesce = false): UndoState {
  if (next === state.present) {
    return state
  }

  if (coalesce && state.past.length > 0) {
    return { past: state.past, present: next, future: [] }
  }

  const past = [...state.past, state.present].slice(-UNDO_LIMIT)
  return { past, present: next, future: [] }
}

export function canUndo(state: UndoState): boolean {
  return state.past.length > 0
}

export function canRedo(state: UndoState): boolean {
  return state.future.length > 0
}

export function undo(state: UndoState): UndoState {
  const previous = state.past[state.past.length - 1]
  if (previous === undefined) {
    return state
  }
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  }
}

export function redo(state: UndoState): UndoState {
  const next = state.future[0]
  if (next === undefined) {
    return state
  }
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  }
}
