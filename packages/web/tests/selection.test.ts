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
    // `keys` rides along empty: the wire shape carries all three ways of naming
    // rows, and a table with no key column simply names none.
    expect(toRowSelection(selection)).toEqual({ ranges: [], ids: [2, 5, 9], keys: [] })
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

/**
 * Choosing rows in a table that changes underneath.
 *
 * For a source that reads from elsewhere the key *is* the selection. Stored as
 * ordinals it would have to be thrown away after every refresh — an ordinal
 * that still exists but now names a different row is a wrong batch that looks
 * entirely right, which is the failure the key column was bought to prevent.
 */
describe('selecting by key', () => {
  // The rows on screen: ordinal 1 is "a", 2 is "b", 3 is "c".
  const keyOf = (ordinal: number): string | undefined => ['a', 'b', 'c'][ordinal - 1]
  const ordinals = [1, 2, 3]

  it('ticks a row by its key rather than its position', () => {
    const next = toggle(EMPTY, 2, ordinals, keyOf)
    expect(next).toEqual({ kind: 'keys', keys: ['b'] })
  })

  it('unticks it again', () => {
    const on = toggle(EMPTY, 2, ordinals, keyOf)
    expect(toggle(on, 2, ordinals, keyOf)).toEqual({ kind: 'keys', keys: [] })
  })

  it('still shows as ticked after the row moves', () => {
    // The producer inserted above it, so "b" is at 3 now. Under a selection
    // stored as ordinals this row would have come untucked and ordinal 2 —
    // somebody else — would show as chosen instead.
    const chosen: Selection = { kind: 'keys', keys: ['b'] }
    const moved = (ordinal: number): string | undefined => ['a', 'inserted', 'b'][ordinal - 1]

    expect(isSelected(chosen, 3, moved)).toBe(true)
    expect(isSelected(chosen, 2, moved)).toBe(false)
  })

  it('counts what was chosen, not what is on the page', () => {
    const chosen: Selection = { kind: 'keys', keys: ['a', 'c'] }
    expect(selectedCount(chosen, 3)).toBe(2)
  })

  it('ticks and unticks a whole page by key', () => {
    const all = togglePage(EMPTY, ordinals, ordinals, keyOf)
    expect(all).toEqual({ kind: 'keys', keys: ['a', 'b', 'c'] })
    expect(togglePage(all, ordinals, ordinals, keyOf)).toEqual({ kind: 'keys', keys: [] })
  })

  it('reports the page as chosen only when every row on it is', () => {
    const some: Selection = { kind: 'keys', keys: ['a'] }
    expect(isPageSelected(some, ordinals, keyOf)).toBe(false)
    expect(isPageSelected({ kind: 'keys', keys: ['a', 'b', 'c'] }, ordinals, keyOf)).toBe(true)
  })

  it('goes on the wire as keys, sorted', () => {
    const chosen: Selection = { kind: 'keys', keys: ['c', 'a'] }
    expect(toRowSelection(chosen)).toEqual({ ranges: [], ids: [], keys: ['a', 'c'] })
  })

  it('leaves selection by position exactly as it was', () => {
    // Every table anybody maintains by hand, and what this did before.
    const chosen = toggle(EMPTY, 2, ordinals)
    expect(chosen).toEqual({ kind: 'explicit', ordinals: [2] })
    expect(toRowSelection(chosen)).toEqual({ ranges: [], ids: [2], keys: [] })
  })

  it('leaves "everything" meaning everything', () => {
    // It has to keep meaning "the table as it stands when this is submitted",
    // which no list of names or numbers can say.
    expect(toRowSelection({ kind: 'all' })).toEqual({ all: true })
  })
})
