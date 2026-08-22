import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  isPageSelected,
  isSelected,
  labelTotal,
  parseRange,
  selectedCount,
  toRowSelection,
  toggle,
  togglePage,
  type Selection,
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

describe('ticking a whole page', () => {
  const all = Array.from({ length: 25 }, (_unused, i) => i + 1)
  const pageOne = [1, 2, 3, 4, 5]
  const pageTwo = [6, 7, 8, 9, 10]

  it('adds the page to an empty selection', () => {
    expect(togglePage(EMPTY, pageOne, all)).toEqual({ kind: 'explicit', ordinals: pageOne })
  })

  it('adds to what was already chosen rather than replacing it', () => {
    // Otherwise paging forward and ticking twice loses the first page, and the
    // count at the top is the only thing that would have said so.
    const afterFirst = togglePage(EMPTY, pageOne, all)
    expect(togglePage(afterFirst, pageTwo, all)).toEqual({
      kind: 'explicit',
      ordinals: [...pageOne, ...pageTwo],
    })
  })

  it('unticks a page that is already wholly chosen', () => {
    const both = togglePage(togglePage(EMPTY, pageOne, all), pageTwo, all)
    expect(togglePage(both, pageOne, all)).toEqual({ kind: 'explicit', ordinals: pageTwo })
  })

  it('ticks the rest when the page is only partly chosen', () => {
    const partial: Selection = { kind: 'explicit', ordinals: [1, 3] }
    expect(togglePage(partial, pageOne, all)).toEqual({ kind: 'explicit', ordinals: pageOne })
  })

  it('turns "everything" explicit rather than clearing it', () => {
    // Same rule as toggling one row: unticking a page out of "all" must leave
    // the other twenty rows chosen.
    const result = togglePage({ kind: 'all' }, pageOne, all)
    expect(result).toEqual({ kind: 'explicit', ordinals: all.filter((n) => n > 5) })
  })

  it('keeps the stored ordinals sorted', () => {
    // The stored order must never look like a print order; printing is by
    // ascending ordinal whatever was ticked first.
    const result = togglePage({ kind: 'explicit', ordinals: [9, 2] }, [5], all)
    expect(result).toEqual({ kind: 'explicit', ordinals: [2, 5, 9] })
  })

  it('does nothing for a page with no rows', () => {
    expect(togglePage(EMPTY, [], all)).toEqual(EMPTY)
  })
})

describe('whether the page in view is wholly selected', () => {
  it('is true when every row on it is chosen', () => {
    expect(isPageSelected({ kind: 'explicit', ordinals: [1, 2, 3] }, [1, 2, 3])).toBe(true)
  })

  it('is false when one is missing', () => {
    expect(isPageSelected({ kind: 'explicit', ordinals: [1, 3] }, [1, 2, 3])).toBe(false)
  })

  it('is true under "everything"', () => {
    expect(isPageSelected({ kind: 'all' }, [7, 8])).toBe(true)
  })

  it('is false for an empty page, which is not "all of nothing"', () => {
    expect(isPageSelected({ kind: 'all' }, [])).toBe(false)
  })
})
