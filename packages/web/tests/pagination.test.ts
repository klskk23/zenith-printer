/**
 * Which page numbers a pagination control offers.
 *
 * Separated from the component because this is where the edge cases are. A
 * sliding window is easy to get subtly wrong at the ends, and wrong at the end
 * means the last page cannot be reached — which is exactly where somebody is
 * heading when a table has grown.
 */
import { describe, expect, it } from 'vitest'
import { pageWindow } from '../src/components/ui/pagination.tsx'

describe('the page window', () => {
  it('shows every page when they all fit', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
  })

  it('is a single page when there is only one', () => {
    expect(pageWindow(1, 1)).toEqual([1])
  })

  it('always offers the first and the last', () => {
    // The two people reach for most. A window that hides the last page makes
    // the end of a long table something you click your way to.
    const slots = pageWindow(50, 100)
    expect(slots[0]).toBe(1)
    expect(slots.at(-1)).toBe(100)
  })

  it('keeps the neighbours of the current page', () => {
    expect(pageWindow(50, 100)).toEqual([1, 'gap', 49, 50, 51, 'gap', 100])
  })

  it('does not open a gap at the start when the current page is near it', () => {
    expect(pageWindow(2, 100)).toEqual([1, 2, 3, 'gap', 100])
  })

  it('does not open a gap at the end when the current page is near it', () => {
    expect(pageWindow(99, 100)).toEqual([1, 'gap', 98, 99, 100])
  })

  it('shows the page rather than a gap when exactly one was skipped', () => {
    // An ellipsis standing for a single page is worse than the page: it takes
    // the same width and costs a click.
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, 'gap', 10])
  })

  it('never repeats a page', () => {
    for (let current = 1; current <= 20; current += 1) {
      const numbers = pageWindow(current, 20).filter((slot): slot is number => slot !== 'gap')
      expect(new Set(numbers).size).toBe(numbers.length)
    }
  })

  it('stays in order and in range for every position', () => {
    for (let current = 1; current <= 30; current += 1) {
      const numbers = pageWindow(current, 30).filter((slot): slot is number => slot !== 'gap')
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
      expect(numbers.every((n) => n >= 1 && n <= 30)).toBe(true)
      expect(numbers).toContain(current)
    }
  })
})
