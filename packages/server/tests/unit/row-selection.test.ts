import { describe, expect, it } from 'vitest'
import { StaleRowSelectionError, expandSelection, labelCount } from '../../src/domain/row-selection.ts'

const table = (n: number): number[] => Array.from({ length: n }, (_unused, i) => i + 1)

describe('all', () => {
  it('means the table as it stands at submission', () => {
    // Not the rows that existed when the box was ticked: `all` is defined at
    // the moment it is acted on, and the window is seconds.
    expect(expandSelection({ all: true }, table(4))).toEqual([1, 2, 3, 4])
  })

  it('is empty for an empty table', () => {
    expect(expandSelection({ all: true }, [])).toEqual([])
  })

  it('does not mind rows having been deleted', () => {
    expect(expandSelection({ all: true }, [1, 3, 7])).toEqual([1, 3, 7])
  })
})

describe('ranges and ids', () => {
  it('expands an inclusive range', () => {
    // "5-12" means twelve is printed, not stopped before.
    expect(expandSelection({ ranges: [[5, 12]] }, table(20))).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('accepts a range given backwards', () => {
    expect(expandSelection({ ranges: [[12, 5]] }, table(20))).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('accepts a single-row range', () => {
    expect(expandSelection({ ranges: [[7, 7]] }, table(20))).toEqual([7])
  })

  it('merges ranges and individual rows without repeating any', () => {
    // A row printed twice because it was both ticked and inside a range is a
    // duplicate label nobody asked for.
    expect(expandSelection({ ranges: [[2, 4]], ids: [3, 9] }, table(10))).toEqual([2, 3, 4, 9])
  })

  it('sorts by table order, whatever order things were ticked in', () => {
    // The labels come off in a stack. A stack in ticking order cannot be
    // checked against the spreadsheet (FR-037).
    expect(expandSelection({ ids: [9, 2, 5] }, table(10))).toEqual([2, 5, 9])
  })

  it('is empty when nothing is named', () => {
    expect(expandSelection({ ranges: [], ids: [] }, table(10))).toEqual([])
  })
})

describe('a selection that has gone stale', () => {
  it('refuses rather than quietly printing fewer labels', () => {
    // Somebody who selected eight rows expects eight labels. Printing seven
    // without saying so leaves a discrepancy to be found at counting time.
    expect(() => expandSelection({ ranges: [[5, 12]] }, [5, 6, 8, 9, 10, 11, 12])).toThrow(
      StaleRowSelectionError,
    )
  })

  it('names every ordinal that has gone, in order', () => {
    try {
      expandSelection({ ids: [3, 7, 9] }, [3])
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as StaleRowSelectionError).missingOrdinals).toEqual([7, 9])
    }
  })

  it('does not refuse when every named row is still there', () => {
    expect(expandSelection({ ids: [3] }, [1, 3, 5])).toEqual([3])
  })
})

describe('labelCount', () => {
  it('is rows times copies', () => {
    expect(labelCount(8, 2)).toBe(16)
  })

  it('is the copy count when there are no rows', () => {
    expect(labelCount(0, 5)).toBe(0)
  })
})
