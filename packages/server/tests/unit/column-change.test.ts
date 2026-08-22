/**
 * What changed about a worksheet's header, and whether anybody must be told.
 *
 * Adding a column cannot hurt a design. Losing one makes every `${that column}`
 * in a design resolve to nothing, and that only becomes visible on a printed
 * label — so it is the one refresh that stops and asks.
 */
import { describe, expect, it } from 'vitest'
import { classifyColumnChange } from '../../src/domain/column-change.ts'

describe('classifying a header change', () => {
  it('says nothing changed when the columns match', () => {
    expect(classifyColumnChange(['a', 'b'], ['a', 'b'])).toEqual({ kind: 'unchanged' })
  })

  it('treats a reordering as no change, because a row is keyed by name', () => {
    expect(classifyColumnChange(['a', 'b'], ['b', 'a'])).toEqual({ kind: 'unchanged' })
  })

  it('reports an added column, which harms nothing', () => {
    expect(classifyColumnChange(['a'], ['a', 'b'])).toEqual({ kind: 'added', added: ['b'] })
  })

  it('reports a removed column as breaking', () => {
    expect(classifyColumnChange(['a', 'b'], ['a'])).toEqual({
      kind: 'breaking',
      removed: ['b'],
      added: [],
    })
  })

  it('cannot tell a rename from a delete-plus-add, and does not pretend to', () => {
    // Google reports only the resulting header. "收件人 renamed to 客户名称"
    // and "收件人 deleted, 客户名称 added" are the same bytes, so the rule is
    // the difference alone. Anything else would be a guess that is wrong about
    // as often as it is right.
    expect(classifyColumnChange(['收件人'], ['客户名称'])).toEqual({
      kind: 'breaking',
      removed: ['收件人'],
      added: ['客户名称'],
    })
  })

  it('is breaking when a column is both lost and gained', () => {
    const result = classifyColumnChange(['a', 'b'], ['a', 'c'])
    expect(result).toEqual({ kind: 'breaking', removed: ['b'], added: ['c'] })
  })

  it('reports every lost column, not just the first', () => {
    expect(classifyColumnChange(['a', 'b', 'c'], ['a'])).toMatchObject({ removed: ['b', 'c'] })
  })

  it('treats losing every column as breaking rather than as unchanged', () => {
    expect(classifyColumnChange(['a'], [])).toMatchObject({ kind: 'breaking', removed: ['a'] })
  })
})
