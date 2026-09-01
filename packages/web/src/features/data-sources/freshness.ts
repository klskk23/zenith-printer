/**
 * How old a table's rows are, and whether that is worth saying out loud.
 *
 * The list page and the binding panel used to print `lastRefreshedAt` through
 * `toLocaleString()` and stop there. A full timestamp is not a fact anybody
 * reads — "2026/8/22 09:14:03" beside a table is furniture — so a table last
 * read ten days ago looked exactly like one read this morning, and printing
 * from ten-day-old rows is not something anybody notices until the labels are
 * in their hands.
 *
 * Two changes, both here: it reads as an age rather than a date, and past a
 * threshold it says so in a colour.
 */

/**
 * When nothing has been asked for, how old is old.
 *
 * A source with no interval configured still has an age worth seeing. A day is
 * the point past which "this morning" stops being a reasonable assumption about
 * a table somebody else maintains.
 */
export const DEFAULT_STALE_AFTER_SECONDS = 24 * 60 * 60

export interface Freshness {
  /** Seconds since the last successful read, or null if there has never been one. */
  ageSeconds: number | null
  /** Whether it is past the point where it should be said in a colour. */
  stale: boolean
  /** Whether a page opening now should fetch, given the configured interval. */
  overdue: boolean
}

export interface FetchedSource {
  lastRefreshedAt?: string | null
  refreshIntervalSeconds?: number
}

export function freshnessOf(source: FetchedSource, now: Date): Freshness {
  const last = source.lastRefreshedAt
  const interval = source.refreshIntervalSeconds ?? 0

  if (last === null || last === undefined) {
    // Never read. Not "stale" — there is nothing here to be out of date, and
    // colouring it would be scolding somebody for a table they just made — but
    // a source with an interval is due for its first read.
    return { ageSeconds: null, stale: false, overdue: interval > 0 }
  }

  const parsed = Date.parse(last)
  if (Number.isNaN(parsed)) {
    return { ageSeconds: null, stale: false, overdue: false }
  }

  // Clamped at zero: a machine whose clock is behind the producer's would
  // otherwise report a negative age, which reads as a bug rather than a clock.
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - parsed) / 1000))
  return {
    ageSeconds,
    stale: ageSeconds >= (interval > 0 ? interval : DEFAULT_STALE_AFTER_SECONDS),
    overdue: interval > 0 && ageSeconds >= interval,
  }
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * An age, in the coarsest unit that still says something.
 *
 * Coarse on purpose: the question is "can I trust these rows", and "3 days"
 * answers it where "3 days 4 hours 11 minutes" makes somebody do arithmetic
 * first. Rounded down, so nothing ever claims to be fresher than it is.
 */
export function ageParts(ageSeconds: number): { unit: 'now' | 'minute' | 'hour' | 'day'; value: number } {
  if (ageSeconds < MINUTE) {
    return { unit: 'now', value: 0 }
  }
  if (ageSeconds < HOUR) {
    return { unit: 'minute', value: Math.floor(ageSeconds / MINUTE) }
  }
  if (ageSeconds < DAY) {
    return { unit: 'hour', value: Math.floor(ageSeconds / HOUR) }
  }
  return { unit: 'day', value: Math.floor(ageSeconds / DAY) }
}
