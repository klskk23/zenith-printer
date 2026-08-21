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
  /**
   * What produced `present`, so the next change can tell whether it continues
   * the same action or starts a new one. Null means "whatever comes next is a
   * new action".
   */
  mergeKey: string | null
}

export function initUndo(present: LabelIR): UndoState {
  return { past: [], present, future: [], mergeKey: null }
}

/**
 * Record a new state.
 *
 * `mergeKey` names the action this change belongs to. Consecutive changes
 * carrying the same key fold into one entry; a different key, or none, starts
 * a new one. Null is the default because most edits are single acts — bringing
 * an element to the front, deleting one, dropping a new one on the canvas.
 *
 * The key is what makes undo mean "the thing I just did" rather than "the last
 * state change the program happened to make". Both of the cases it exists for
 * were reported as undo being broken:
 *
 *   - **a drag** emits a state per pointer move, each snapped to the grid, so
 *     undo walked back one grid step at a time and a drag across the label
 *     took twenty presses to reverse.
 *   - **typing** emits a state per keystroke, so undo deleted one character at
 *     a time — and the fifty-entry limit meant a long field pushed everything
 *     else out of the history.
 *
 * A pause does not end an action; moving to another field or doing something
 * else does. That keeps this decidable without a clock, which keeps it
 * testable and keeps two identical sequences of edits producing two identical
 * histories.
 */
export function commit(state: UndoState, next: LabelIR, mergeKey: string | null = null): UndoState {
  if (next === state.present) {
    return state
  }

  // The first change of all still has to create an entry: there is nothing
  // behind `present` to fold into.
  const continues = mergeKey !== null && mergeKey === state.mergeKey && state.past.length > 0
  if (continues) {
    return { past: state.past, present: next, future: [], mergeKey }
  }

  const past = [...state.past, state.present].slice(-UNDO_LIMIT)
  return { past, present: next, future: [], mergeKey }
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
    // Undoing ends whatever action was in progress. Typing again after an undo
    // starts a new entry rather than folding into the one just restored.
    mergeKey: null,
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
    mergeKey: null,
  }
}
