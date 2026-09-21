/**
 * Two questions a draft has to answer before it is trusted.
 *
 *   - Is the server ahead of the version this draft started from? If so the
 *     editor warns before opening it (FR-027), because saving would be
 *     refused and the person should know that before they add an hour to it.
 *   - Did another window on this machine write it since I last did? If so
 *     the editor says so (FR-029) rather than silently showing somebody else's
 *     edits as your own.
 */
import { describe, expect, it } from 'vitest'
import { changedByAnotherWindow, isBaselineStale } from '../../src/features/drafts/version.ts'

describe('isBaselineStale', () => {
  it('is stale when the server has moved past the baseline', () => {
    expect(isBaselineStale({ baseVersion: 3 }, 4)).toBe(true)
  })

  it('is current when the server is at the baseline', () => {
    expect(isBaselineStale({ baseVersion: 3 }, 3)).toBe(false)
  })

  it('is current when the server is somehow behind', () => {
    // Cannot normally happen; treated as "not stale" because there is no
    // newer version to lose.
    expect(isBaselineStale({ baseVersion: 3 }, 2)).toBe(false)
  })

  it('is never stale for a label that has no server version yet', () => {
    expect(isBaselineStale({ baseVersion: null }, 7)).toBe(false)
  })
})

describe('changedByAnotherWindow', () => {
  const mine = { writerId: 'win-a', updatedAt: '2026-09-21T10:05:00.000Z' }
  const theirs = { writerId: 'win-b', updatedAt: '2026-09-21T10:05:00.000Z' }

  it('is true when another window wrote after my last write', () => {
    expect(changedByAnotherWindow(theirs, 'win-a', '2026-09-21T10:00:00.000Z')).toBe(true)
  })

  it('is false when the last writer was me', () => {
    expect(changedByAnotherWindow(mine, 'win-a', '2026-09-21T10:00:00.000Z')).toBe(false)
  })

  it('is false when the other write is older than mine', () => {
    expect(changedByAnotherWindow(theirs, 'win-a', '2026-09-21T10:10:00.000Z')).toBe(false)
  })

  it('is true when I have never written and someone else has', () => {
    // A draft found on opening that some other window left: that is still
    // "another window changed it", from the point of view of this one.
    expect(changedByAnotherWindow(theirs, 'win-a', null)).toBe(true)
  })
})
