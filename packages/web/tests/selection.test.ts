import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  isSelected,
  labelTotal,
  parseRange,
  selectedCount,
  toRowSelection,
  toggle,
} from '../src/features/print/selection.ts'

const table = (n: number): number[] => Array.from({ length: n }, (_unused, i) => i + 1)

describe('select-all', () => {
  it('travels as an intent, not as a list', () => {
    // The server evaluates it at submission, so a row added in between is
    // included — which an expanded list could not express.
    expect(toRowSelection({ kind: 'all' })).toEqual({ all: true })
  })

  it('counts the whole table', () => {
    expect(selectedCount({ kind: 'all' }, 200)).toBe(200)
  })

  it('reports every row as selected', () => {
    expect(isSelected({ kind: 'all' }, 137)).toBe(true)
  })

  it('becomes explicit when one row is unticked, keeping the rest', () => {
    // Otherwise unticking one row would silently clear the other 199.
    const next = toggle({ kind: 'all' }, 3, table(5))
    expect(next).toEqual({ kind: 'explicit', ordinals: [1, 2, 4, 5] })
  })
})

describe('ticking rows', () => {
  it('adds and removes', () => {
    let selection = toggle(EMPTY, 5, table(10))
    expect(selection).toEqual({ kind: 'explicit', ordinals: [5] })
    selection = toggle(selection, 5, table(10))
    expect(selection).toEqual({ kind: 'explicit', ordinals: [] })
  })

  it('sends ordinals in table order however they were ticked', () => {
    const selection = { kind: 'explicit' as const, ordinals: [9, 2, 5] }
    expect(toRowSelection(selection)).toEqual({ ranges: [], ids: [2, 5, 9] })
  })
})

describe('parseRange', () => {
  it('reads an inclusive range', () => {
    expect(parseRange('5-12', 20)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('reads a single row', () => {
    expect(parseRange('7', 20)).toEqual([7])
  })

  it('reads a list of ranges and rows', () => {
    expect(parseRange('1-2, 5, 8-9', 20)).toEqual([1, 2, 5, 8, 9])
  })

  it('accepts a Chinese comma, which a Chinese keyboard produces', () => {
    expect(parseRange('1，3', 20)).toEqual([1, 3])
  })

  it('accepts a range written backwards', () => {
    expect(parseRange('12-5', 20)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('de-duplicates overlapping pieces', () => {
    expect(parseRange('1-3, 2-4', 20)).toEqual([1, 2, 3, 4])
  })

  it('refuses a range past the end of the table', () => {
    // Saying "that is not a range" beats selecting nothing and looking broken.
    expect(parseRange('5-999', 20)).toBeNull()
  })

  it('refuses row zero, since ordinals start at one', () => {
    expect(parseRange('0-3', 20)).toBeNull()
  })

  it('refuses text that is not a range', () => {
    expect(parseRange('abc', 20)).toBeNull()
    expect(parseRange('5--12', 20)).toBeNull()
  })

  it('refuses an empty input rather than selecting nothing silently', () => {
    expect(parseRange('   ', 20)).toBeNull()
  })
})

describe('labelTotal', () => {
  it('is rows times copies', () => {
    expect(labelTotal({ kind: 'explicit', ordinals: [1, 2, 3] }, 100, 2)).toBe(6)
  })

  it('uses the whole table for select-all', () => {
    expect(labelTotal({ kind: 'all' }, 200, 2)).toBe(400)
  })
})
