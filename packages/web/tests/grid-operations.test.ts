import { describe, expect, it } from 'vitest'
import { patchFromOperations } from '../src/features/data-sources/grid-operations.ts'

/**
 * Turning a grid's change description into a row patch.
 *
 * This is the seam we own. The grid decides what happened; the server needs it
 * as upserts and deletes against *ordinals*, and ordinals are positions — so a
 * delete shifts every row after it. Getting that wrong writes one row's values
 * over another's, which is the kind of mistake that only shows up on a printed
 * label.
 */
const rows = (...values: string[]): Array<Record<string, string>> =>
  values.map((value) => ({ a: value, b: `${value}!` }))

describe('editing cells', () => {
  it('sends the rows an UPDATE covers, by ordinal', () => {
    // Ordinals are 1-based; the grid's row indices are 0-based.
    const patch = patchFromOperations(rows('x', 'y', 'z'), [
      { type: 'UPDATE', fromRowIndex: 1, toRowIndex: 2 },
    ])
    expect(patch.upserts).toEqual([{ ordinal: 2, values: { a: 'y', b: 'y!' } }])
    expect(patch.deletes).toEqual([])
  })

  it('covers a multi-row UPDATE, which is what a paste produces', () => {
    const patch = patchFromOperations(rows('x', 'y', 'z'), [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 3 },
    ])
    expect(patch.upserts.map((u) => u.ordinal)).toEqual([1, 2, 3])
  })

  it('treats toRowIndex as exclusive, as the grid does', () => {
    // Off by one here writes a neighbouring row.
    const patch = patchFromOperations(rows('x', 'y', 'z'), [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 1 },
    ])
    expect(patch.upserts.map((u) => u.ordinal)).toEqual([1])
  })
})

describe('rows appended past the end', () => {
  it('sends a CREATE as an upsert at the new ordinal', () => {
    // Pasting three rows onto a two-row table: two updates and one new row.
    const patch = patchFromOperations(rows('x', 'y', 'z'), [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 2 },
      { type: 'CREATE', fromRowIndex: 2, toRowIndex: 3 },
    ])
    expect(patch.upserts.map((u) => u.ordinal)).toEqual([1, 2, 3])
    expect(patch.upserts[2]).toEqual({ ordinal: 3, values: { a: 'z', b: 'z!' } })
  })

  it('does not send the same ordinal twice when the ranges overlap', () => {
    // A duplicate upsert is not wrong on the server, but it doubles the
    // payload of a thousand-row paste for nothing.
    const patch = patchFromOperations(rows('x', 'y'), [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 2 },
      { type: 'CREATE', fromRowIndex: 1, toRowIndex: 2 },
    ])
    expect(patch.upserts.map((u) => u.ordinal)).toEqual([1, 2])
  })
})

describe('deleting rows', () => {
  it('sends the ordinals the rows had before the delete', () => {
    // The grid reports indices into the *old* table. Reading them against the
    // new one would delete the wrong rows.
    const after = rows('x', 'z')
    const patch = patchFromOperations(after, [{ type: 'DELETE', fromRowIndex: 1, toRowIndex: 2 }])
    expect(patch.deletes).toEqual([2])
    expect(patch.upserts).toEqual([])
  })

  it('sends every ordinal in a multi-row delete', () => {
    const patch = patchFromOperations(rows('x'), [{ type: 'DELETE', fromRowIndex: 1, toRowIndex: 3 }])
    expect(patch.deletes).toEqual([2, 3])
  })

  it('does not try to upsert rows it just deleted', () => {
    const patch = patchFromOperations(rows('x'), [
      { type: 'DELETE', fromRowIndex: 1, toRowIndex: 2 },
    ])
    expect(patch.upserts).toEqual([])
  })
})

describe('values stay strings', () => {
  it('keeps a leading zero', () => {
    // The same rule as the importer: `007` becoming `7` is data loss found on
    // a printed label.
    const patch = patchFromOperations([{ a: '007', b: '' }], [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 1 },
    ])
    expect(patch.upserts[0]?.values.a).toBe('007')
  })

  it('keeps an empty cell as an empty string, not as an absent key', () => {
    // An absent key would leave the old value in place on the server, so
    // clearing a cell would silently do nothing.
    const patch = patchFromOperations([{ a: '', b: 'x' }], [
      { type: 'UPDATE', fromRowIndex: 0, toRowIndex: 1 },
    ])
    expect(patch.upserts[0]?.values).toEqual({ a: '', b: 'x' })
  })

  it('substitutes an empty string for a cell the grid left undefined', () => {
    // A row appended by the grid starts with whatever `createRow` returned;
    // undefined must not reach the server as a missing column.
    const patch = patchFromOperations([{ a: 'x' } as Record<string, string>], [
      { type: 'CREATE', fromRowIndex: 0, toRowIndex: 1 },
    ])
    expect(patch.upserts[0]?.values).toMatchObject({ a: 'x' })
  })
})

describe('nothing to do', () => {
  it('produces an empty patch for no operations', () => {
    expect(patchFromOperations(rows('x'), [])).toEqual({ upserts: [], deletes: [] })
  })

  it('ignores an operation that names no rows', () => {
    expect(patchFromOperations(rows('x'), [{ type: 'UPDATE', fromRowIndex: 1, toRowIndex: 1 }])).toEqual(
      { upserts: [], deletes: [] },
    )
  })
})
