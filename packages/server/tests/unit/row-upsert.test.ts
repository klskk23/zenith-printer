/**
 * Merging a fetched table into a stored one by key.
 *
 * The property under test is the one the key column was bought for: after an
 * upstream insert or delete, a row a person already chose still means the same
 * row. Under the old whole-table rebuild it did not, and nothing said so —
 * ordinals shifted, the selection still named ordinals that existed, and the
 * wrong labels came out.
 */
import { describe, expect, it } from 'vitest'
import {
  DuplicateRowKeyError,
  MissingRowKeyError,
  keyRows,
  planUpsert,
} from '../../src/domain/row-upsert.ts'

const row = (id: string, extra: Record<string, string> = {}) => ({ id, name: `名字-${id}`, ...extra })
const keyed = (...ids: string[]) => keyRows(ids.map((id) => row(id)), 'id')

describe('reading the key', () => {
  it('takes it from the named column', () => {
    expect(keyed('a', 'b').map((r) => r.key)).toEqual(['a', 'b'])
  })

  it('refuses a row with nothing in that column', () => {
    // Dropping it would lose data nobody asked to lose.
    expect(() => keyRows([{ id: '', name: 'x' }], 'id')).toThrow(MissingRowKeyError)
  })

  it('refuses whitespace as a key', () => {
    expect(() => keyRows([{ id: '   ', name: 'x' }], 'id')).toThrow(MissingRowKeyError)
  })

  it('says which row, so it can be found upstream', () => {
    try {
      keyRows([row('a'), row('b'), { id: '', name: 'x' }], 'id')
      expect.unreachable()
    } catch (err) {
      expect((err as MissingRowKeyError).rowIndex).toBe(2)
    }
  })

  it('refuses duplicates, naming every offending value', () => {
    // One at a time is a slow way to find out there were nine.
    try {
      keyRows([row('a'), row('b'), row('a'), row('c'), row('b')], 'id')
      expect.unreachable()
    } catch (err) {
      expect((err as DuplicateRowKeyError).duplicates).toEqual(['a', 'b'])
    }
  })
})

describe('what survives a refresh', () => {
  it('keeps a row that is still there, in its place', () => {
    const plan = planUpsert(keyed('a', 'b', 'c'), keyed('a', 'b', 'c'))
    expect(plan.rows.map((r) => r.key)).toEqual(['a', 'b', 'c'])
    expect(plan).toMatchObject({ added: 0, updated: 0, removed: 0 })
  })

  it('does not move the rows below an upstream insert', () => {
    // The whole point. Under the old rebuild, `b` moved from 2 to 3 and a
    // selection of ordinal 2 quietly became a different row.
    const plan = planUpsert(keyed('a', 'b'), keyRows([row('a'), row('new'), row('b')], 'id'))
    expect(plan.rows.map((r) => r.key)).toEqual(['a', 'b', 'new'])
    expect(plan.added).toBe(1)
  })

  it('drops a row the producer stopped sending', () => {
    const plan = planUpsert(keyed('a', 'b', 'c'), keyed('a', 'c'))
    expect(plan.rows.map((r) => r.key)).toEqual(['a', 'c'])
    expect(plan.removed).toBe(1)
  })

  it('takes the new values for a row that stayed', () => {
    const plan = planUpsert(
      keyRows([row('a', { 状态: '在库' })], 'id'),
      keyRows([row('a', { 状态: '已出库' })], 'id'),
    )
    expect(plan.rows[0]?.values.状态).toBe('已出库')
    expect(plan.updated).toBe(1)
  })

  it('replaces the values whole rather than merging them', () => {
    // A column the producer stopped sending is gone; merged, its last value
    // would sit there looking current.
    const plan = planUpsert(
      keyRows([{ id: 'a', 备注: '旧的' }], 'id'),
      keyRows([{ id: 'a' }], 'id'),
    )
    expect(plan.rows[0]?.values).toEqual({ id: 'a' })
  })

  it('counts a row that came back identical as untouched', () => {
    // "Applied" with no numbers cannot be told apart from "did nothing".
    const plan = planUpsert(keyed('a'), keyed('a'))
    expect(plan.updated).toBe(0)
  })

  it('handles the producer going empty without losing the count', () => {
    const plan = planUpsert(keyed('a', 'b'), [])
    expect(plan.rows).toEqual([])
    expect(plan.removed).toBe(2)
  })

  it('handles a first refresh into an empty table', () => {
    const plan = planUpsert([], keyed('a', 'b'))
    expect(plan.rows.map((r) => r.key)).toEqual(['a', 'b'])
    expect(plan).toMatchObject({ added: 2, updated: 0, removed: 0 })
  })

  it('survives the producer reordering everything', () => {
    // Order upstream is not order here: reshuffling a table under somebody
    // reading it serves nothing, since the key is what decides what prints.
    const plan = planUpsert(keyed('a', 'b', 'c'), keyed('c', 'b', 'a'))
    expect(plan.rows.map((r) => r.key)).toEqual(['a', 'b', 'c'])
    expect(plan).toMatchObject({ added: 0, removed: 0 })
  })
})
