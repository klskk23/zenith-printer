/**
 * How old a table's rows are.
 *
 * The behaviour this replaces printed a full timestamp and stopped. On this
 * machine two Google-backed sources were last read ten days ago and the
 * interface said nothing about it — a date beside a table is furniture, and
 * nobody reads furniture.
 *
 * `now` is injected, as the constitution requires: a test that read the real
 * clock would be testing what time it is.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_STALE_AFTER_SECONDS, ageParts, freshnessOf } from '../src/features/data-sources/freshness.ts'

const NOW = new Date('2026-09-01T12:00:00Z')
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()

describe('age', () => {
  it('is counted from the last successful read', () => {
    expect(freshnessOf({ lastRefreshedAt: ago(90) }, NOW).ageSeconds).toBe(90)
  })

  it('is unknown for a table nobody has read yet', () => {
    expect(freshnessOf({ lastRefreshedAt: null }, NOW).ageSeconds).toBeNull()
  })

  it('never goes negative when the clocks disagree', () => {
    // A machine behind the producer would otherwise report a negative age,
    // which reads as a bug rather than as a clock.
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    expect(freshnessOf({ lastRefreshedAt: future }, NOW).ageSeconds).toBe(0)
  })

  it('survives a timestamp that is not one', () => {
    expect(freshnessOf({ lastRefreshedAt: 'sometime last week' }, NOW)).toMatchObject({
      ageSeconds: null,
      stale: false,
    })
  })
})

describe('when it is worth saying in a colour', () => {
  it('is not, for a table read a minute ago', () => {
    expect(freshnessOf({ lastRefreshedAt: ago(60) }, NOW).stale).toBe(false)
  })

  it('is, past a day, even with no interval configured', () => {
    // The case that was invisible: nothing was asked for, so nothing was said,
    // and the rows were ten days old.
    expect(freshnessOf({ lastRefreshedAt: ago(10 * 24 * 3600) }, NOW).stale).toBe(true)
  })

  it('uses the configured interval when there is one', () => {
    const source = { lastRefreshedAt: ago(400), refreshIntervalSeconds: 300 }
    expect(freshnessOf(source, NOW).stale).toBe(true)
  })

  it('and a long interval means a long time is not stale', () => {
    // Somebody who asked for hourly refreshes has said what they consider
    // fresh; the default must not overrule them in either direction.
    const source = { lastRefreshedAt: ago(2 * 3600), refreshIntervalSeconds: 6 * 3600 }
    expect(freshnessOf(source, NOW).stale).toBe(false)
  })

  it('is not, for a table nobody has read yet', () => {
    // Nothing here is out of date; colouring it would scold somebody for a
    // table they have only just made.
    expect(freshnessOf({ lastRefreshedAt: null, refreshIntervalSeconds: 300 }, NOW).stale).toBe(false)
  })

  it('has a default of a day', () => {
    expect(DEFAULT_STALE_AFTER_SECONDS).toBe(86_400)
  })
})

describe('when a page opening should fetch', () => {
  it('never, without an interval — that is what "only when asked" means', () => {
    // Exactly what this product did before any of this existed.
    expect(freshnessOf({ lastRefreshedAt: ago(10 * 24 * 3600) }, NOW).overdue).toBe(false)
  })

  it('once the interval has passed', () => {
    expect(freshnessOf({ lastRefreshedAt: ago(400), refreshIntervalSeconds: 300 }, NOW).overdue).toBe(true)
  })

  it('not before it has', () => {
    expect(freshnessOf({ lastRefreshedAt: ago(120), refreshIntervalSeconds: 300 }, NOW).overdue).toBe(false)
  })

  it('immediately for a table with an interval and no read behind it', () => {
    expect(freshnessOf({ lastRefreshedAt: null, refreshIntervalSeconds: 300 }, NOW).overdue).toBe(true)
  })

  it('immediately for a table never read at all, interval or not', () => {
    /**
     * The interval governs *re-reading*: 0 means "do not go back on a
     * schedule". It was also being read as "never read it", which left a
     * freshly connected source sitting at zero rows and — for a ledger source,
     * which is created knowing only its key column — a single column, until
     * somebody discovered there was a button to press.
     *
     * Connecting a table *is* the request to read it. Nobody connects one in
     * order not to see it.
     */
    expect(freshnessOf({ lastRefreshedAt: null }, NOW).overdue).toBe(true)
    expect(freshnessOf({ lastRefreshedAt: null, refreshIntervalSeconds: 0 }, NOW).overdue).toBe(true)
  })

  it('still not for a table that has been read once and asked for no schedule', () => {
    // The distinction the change above must not blur: never read is not the
    // same as read and left alone.
    expect(freshnessOf({ lastRefreshedAt: ago(10), refreshIntervalSeconds: 0 }, NOW).overdue).toBe(false)
  })
})

describe('how an age reads', () => {
  it('says "just now" under a minute', () => {
    expect(ageParts(30)).toEqual({ unit: 'now', value: 0 })
  })

  it('counts minutes, then hours, then days', () => {
    expect(ageParts(5 * 60)).toEqual({ unit: 'minute', value: 5 })
    expect(ageParts(3 * 3600)).toEqual({ unit: 'hour', value: 3 })
    expect(ageParts(10 * 86_400)).toEqual({ unit: 'day', value: 10 })
  })

  it('rounds down, so nothing claims to be fresher than it is', () => {
    expect(ageParts(119)).toEqual({ unit: 'minute', value: 1 })
    expect(ageParts(86_400 - 1)).toEqual({ unit: 'hour', value: 23 })
    expect(ageParts(2 * 86_400 - 1)).toEqual({ unit: 'day', value: 1 })
  })
})
