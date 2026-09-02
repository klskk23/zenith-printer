/**
 * Refresh a table on opening, when it has gone past the interval it asked for.
 *
 * Only when it asked. `refreshIntervalSeconds` defaults to 0 and 0 means "only
 * when somebody presses the button" — which is what this product did
 * exclusively, for a good reason: until a row had an identity that survived a
 * refresh, refreshing under somebody was how a selection came to mean different
 * rows. That reason is gone for a table with a key column, so this is offered.
 * It stays off unless asked for.
 *
 * **A failure here does not block anything.** The rows already stored are shown
 * and printed as they always were; the page says how old they are and that this
 * attempt failed. A page that refused to load because somebody else's system is
 * down would be this one inventing an outage of its own.
 */
import { useEffect, useRef, useState } from 'react'
import { freshnessOf } from './freshness.ts'
import { isFetched, useRefreshDataSource, type DataSource } from './hooks.ts'

export interface AutoRefreshState {
  /** True while the automatic attempt is in flight. */
  running: boolean
  /** True when the attempt finished without applying. The old rows still stand. */
  failed: boolean
}

export function useAutoRefresh(source: DataSource | undefined): AutoRefreshState {
  const refresh = useRefreshDataSource()
  const [failed, setFailed] = useState(false)
  /**
   * Sources this hook has already fired for.
   *
   * Once per source per mount. The refresh updates `lastRefreshedAt`, which
   * re-renders this, which would otherwise decide all over again — and a
   * failure leaves the timestamp untouched, so a failing source would be
   * retried on every render for as long as the page stayed open.
   */
  const fired = useRef(new Set<string>())

  const id = source?.id
  /**
   * Only a table that is fetched from somewhere.
   *
   * A table maintained here has no producer to go back to, and `freshnessOf`
   * cannot tell — it is given a timestamp and an interval, not a kind. A CSV
   * somebody uploaded has never been "read", so treating that as overdue sent
   * a refresh at an endpoint that has nothing to refresh from.
   */
  const overdue =
    source === undefined || !isFetched(source) ? false : freshnessOf(source, new Date()).overdue

  useEffect(() => {
    if (id === undefined || !overdue || fired.current.has(id)) {
      return
    }
    fired.current.add(id)
    setFailed(false)
    refresh.mutate(
      { id },
      {
        onSuccess: (result) => setFailed(result.outcome !== 'applied'),
        onError: () => setFailed(true),
      },
    )
    // `refresh` is in here because it is a dependency and the rule is right
    // about that. It is a fresh object each render, so this effect re-enters
    // often — the `fired` set above is what makes that harmless, and is the
    // thing actually holding the "once per source" guarantee. Do not remove it
    // on the grounds that the dependency list looks narrow enough.
  }, [id, overdue, refresh])

  return { running: refresh.isPending, failed }
}
