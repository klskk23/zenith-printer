/**
 * Undo and redo for the table editor.
 *
 * The rows live on the server, so undo cannot just restore local state — it has
 * to put the server back. It does that by **diffing** the table it wants
 * against the table there is, and sending the result as an ordinary patch.
 *
 * The alternative was to record an inverse for each operation. That sounds
 * cheaper and is much easier to get wrong: the inverse of deleting a row in the
 * middle is not "insert at that ordinal", because the server renumbers, and an
 * inverse that is subtly wrong writes one row's values over another's — which
 * is only visible once the labels are printed. A diff cannot drift from the
 * thing it is describing.
 */
import type { GridRow, RowPatch } from './grid-operations.ts'

/**
 * Steps kept.
 *
 * A thousand-row paste snapshots a thousand rows, so an unbounded stack is a
 * slow leak in a page that stays open all day. Fifty is far more than anybody
 * steps back through and still bounded.
 */
export const MAX_STEPS = 50

export interface History<T> {
  past: readonly T[]
  future: readonly T[]
  canUndo: boolean
  canRedo: boolean
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], canUndo: false, canRedo: false }
}

function build<T>(past: readonly T[], future: readonly T[]): History<T> {
  return { past, future, canUndo: past.length > 0, canRedo: future.length > 0 }
}

/**
 * Record the state an edit is moving away from.
 *
 * Clears the redo stack: after a new edit, the states ahead no longer follow
 * from this one, and stepping forward into them would produce a table that
 * never existed.
 */
export function pushHistory<T>(history: History<T>, previous: T): History<T> {
  const past = [...history.past, previous].slice(-MAX_STEPS)
  return build(past, [])
}

export interface Step<T> {
  /** The state to move to, or null when there is nowhere to go. */
  state: T | null
  history: History<T>
}

export function undo<T>(history: History<T>, current: T): Step<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) {
    return { state: null, history }
  }
  return {
    state: previous,
    history: build(history.past.slice(0, -1), [current, ...history.future]),
  }
}

export function redo<T>(history: History<T>, current: T): Step<T> {
  const next = history.future.at(0)
  if (next === undefined) {
    return { state: null, history }
  }
  return {
    state: next,
    history: build([...history.past, current], history.future.slice(1)),
  }
}

function sameRow(a: GridRow | undefined, b: GridRow | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) {
      return false
    }
  }
  return true
}

/**
 * The patch that turns `from` into `to`.
 *
 * Removals are always of the *trailing* rows, because the server renumbers
 * after a delete — taking the last rows off is the only removal that means the
 * same thing on both sides. Restoring a row that was deleted from the middle
 * therefore rewrites everything after the gap and appends one. Not minimal, but
 * correct, and undo is a rare deliberate action rather than a hot path.
 */
export function diffRows(from: readonly GridRow[], to: readonly GridRow[]): RowPatch {
  const upserts: RowPatch['upserts'] = []
  for (const [index, row] of to.entries()) {
    if (!sameRow(from[index], row)) {
      upserts.push({ ordinal: index + 1, values: { ...row } })
    }
  }

  const deletes: number[] = []
  for (let index = to.length; index < from.length; index += 1) {
    deletes.push(index + 1)
  }

  return { upserts, deletes }
}
