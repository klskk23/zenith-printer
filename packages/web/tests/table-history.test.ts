import { describe, expect, it } from 'vitest'
import { diffRows, emptyHistory, pushHistory, redo, undo } from '../src/features/data-sources/table-history.ts'
import type { GridRow } from '../src/features/data-sources/grid-operations.ts'

/**
 * Undo for the table editor.
 *
 * The rows live on the server, so undo cannot simply restore local state: it
 * has to send the server back to where it was. It does that by diffing the
 * table it wants against the table there is, which is the same shape as any
 * other edit and needs no separate inverse-operation machinery to get wrong.
 */
const rows = (...values: string[]): GridRow[] => values.map((a) => ({ a, b: `${a}!` }))

describe('diffing two tables', () => {
  it('is empty when nothing changed', () => {
    expect(diffRows(rows('x', 'y'), rows('x', 'y'))).toEqual({ upserts: [], deletes: [] })
  })

  it('upserts only the rows that differ', () => {
    const patch = diffRows(rows('x', 'y', 'z'), rows('x', 'CHANGED', 'z'))
    expect(patch.upserts).toEqual([{ ordinal: 2, values: { a: 'CHANGED', b: 'CHANGED!' } }])
    expect(patch.deletes).toEqual([])
  })

  it('notices a single cell inside a row', () => {
    const patch = diffRows([{ a: 'x', b: 'one' }], [{ a: 'x', b: 'two' }])
    expect(patch.upserts).toEqual([{ ordinal: 1, values: { a: 'x', b: 'two' } }])
  })

  it('upserts rows the target has and the source does not', () => {
    const patch = diffRows(rows('x'), rows('x', 'y'))
    expect(patch.upserts).toEqual([{ ordinal: 2, values: { a: 'y', b: 'y!' } }])
  })

  it('deletes the trailing rows the target does not have', () => {
    // Trailing, because the server renumbers after a delete: taking the last
    // rows off is the only removal that means the same thing on both sides.
    const patch = diffRows(rows('x', 'y', 'z'), rows('x'))
    expect(patch.deletes).toEqual([2, 3])
    expect(patch.upserts).toEqual([])
  })

  it('rewrites the rows that shifted when one was removed from the middle', () => {
    // Undoing a middle deletion cannot re-insert; it rewrites from the gap
    // onwards and appends. Not minimal, but it is right, and undo is rare.
    const patch = diffRows(rows('x', 'z'), rows('x', 'y', 'z'))
    expect(patch.upserts.map((u) => u.ordinal)).toEqual([2, 3])
    expect(patch.deletes).toEqual([])
  })

  it('keeps values as strings', () => {
    const patch = diffRows([{ a: '1', b: '' }], [{ a: '007', b: '' }])
    expect(patch.upserts[0]?.values.a).toBe('007')
  })
})

describe('the history stack', () => {
  it('starts with nothing to undo or redo', () => {
    const history = emptyHistory<GridRow[]>()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  it('offers an undo once something has been pushed', () => {
    const history = pushHistory(emptyHistory<GridRow[]>(), rows('x'))
    expect(history.canUndo).toBe(true)
  })

  it('gives back the state that was pushed', () => {
    const history = pushHistory(emptyHistory<GridRow[]>(), rows('x'))
    const stepped = undo(history, rows('y'))
    expect(stepped.state).toEqual(rows('x'))
  })

  it('can redo what it just undid', () => {
    // The state undo was called *from* becomes the redo target.
    const history = pushHistory(emptyHistory<GridRow[]>(), rows('x'))
    const undone = undo(history, rows('y'))
    expect(undone.history.canRedo).toBe(true)
    expect(redo(undone.history, rows('x')).state).toEqual(rows('y'))
  })

  it('drops the redo stack once a new edit is made', () => {
    // Otherwise redo would jump to a table that no longer follows from this one.
    const history = pushHistory(emptyHistory<GridRow[]>(), rows('x'))
    const undone = undo(history, rows('y'))
    const edited = pushHistory(undone.history, rows('z'))
    expect(edited.canRedo).toBe(false)
  })

  it('returns the same state when there is nothing to undo', () => {
    const history = emptyHistory<GridRow[]>()
    const stepped = undo(history, rows('x'))
    expect(stepped.state).toBeNull()
    expect(stepped.history).toBe(history)
  })

  it('returns the same state when there is nothing to redo', () => {
    const history = emptyHistory<GridRow[]>()
    expect(redo(history, rows('x')).state).toBeNull()
  })

  it('steps back through several edits one at a time', () => {
    let history = emptyHistory<GridRow[]>()
    history = pushHistory(history, rows('1'))
    history = pushHistory(history, rows('2'))

    const first = undo(history, rows('3'))
    expect(first.state).toEqual(rows('2'))
    const second = undo(first.history, rows('2'))
    expect(second.state).toEqual(rows('1'))
  })

  it('forgets the oldest step rather than growing without limit', () => {
    // A thousand-row paste snapshots a thousand rows; an unbounded stack is a
    // slow leak in a page that stays open all day.
    let history = emptyHistory<GridRow[]>()
    for (let step = 0; step < 60; step += 1) {
      history = pushHistory(history, rows(String(step)))
    }
    expect(history.past.length).toBeLessThanOrEqual(50)
    // The most recent step is still the one undo reaches first.
    expect(undo(history, rows('now')).state).toEqual(rows('59'))
  })
})
