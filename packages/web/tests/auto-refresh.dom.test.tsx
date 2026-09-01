/**
 * Refreshing a table on opening, when it has gone past the interval it asked for.
 *
 * Two failure modes, both invisible until they hurt:
 *
 *   - **firing more than once.** A refresh that fails leaves the timestamp
 *     untouched, so "is it overdue" stays true; without a guard the page
 *     hammers somebody else's system for as long as it stays open.
 *   - **blocking.** A page that refuses to load because the producer is down
 *     would be this application inventing an outage of its own. The rows
 *     already stored are what printing uses, and they are still fine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourceBinding } from '../src/editor/data-source-binding.tsx'

const refreshes: string[] = []
let refreshOutcome: Record<string, unknown> = { outcome: 'applied', rowsBefore: 3, rowsAfter: 3 }
let source: Record<string, unknown>

/**
 * Ten minutes ago, against a source that asked to be refreshed every five.
 *
 * Relative to the real clock on purpose: the component under test reads the
 * real clock to work out an age, so a fixed timestamp would drift from "ten
 * minutes ago" into "eight months ago" and stop testing the boundary. What the
 * arithmetic does with an instant is pinned deterministically in
 * freshness.test.ts, where `now` is injected.
 */
const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000).toISOString()

const base = {
  id: 'ds-1',
  name: '设备表',
  columns: ['sys_id', 'mac'],
  rowCount: 3,
  sourceKind: 'http',
  http: { url: 'http://producer.invalid/rows', headerNames: ['Authorization'] },
  keyColumn: 'sys_id',
  createdAt: 'T',
  updatedAt: 'T',
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  refreshes.length = 0
  refreshOutcome = { outcome: 'applied', rowsBefore: 3, rowsAfter: 3 }
  source = { ...base, refreshIntervalSeconds: 300, lastRefreshedAt: TEN_MINUTES_AGO }
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/refresh')) {
      refreshes.push(url)
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(refreshOutcome),
        text: () => Promise.resolve(JSON.stringify(refreshOutcome)),
      } as unknown as Response)
    }
    const body = url.includes('/data-sources') ? { dataSources: [source] } : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const panel = (): void => {
  render(wrap(<DataSourceBinding dataSourceId="ds-1" onChange={() => undefined} bindingIssue={null} />))
}

describe('a table that asked to be kept fresh', () => {
  it('is refreshed when the page opens past its interval', async () => {
    panel()
    await waitFor(() => expect(refreshes).toHaveLength(1))
  })

  it('is refreshed once, not once per render', async () => {
    // A failed refresh leaves the timestamp alone, so "overdue" stays true.
    // Without the guard this hammers the other system for as long as the page
    // is open.
    refreshOutcome = { outcome: 'failed', reason: 'unreachable' }
    panel()
    await waitFor(() => expect(refreshes).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(refreshes).toHaveLength(1)
  })

  it('says so when the attempt failed, and shows the rows anyway', async () => {
    refreshOutcome = { outcome: 'failed', reason: 'unreachable' }
    panel()
    expect(await screen.findByText(/本次自动刷新失败/)).toBeDefined()
    // The panel is still there with its columns; nothing was blocked.
    expect(await screen.findByText(/mac/)).toBeDefined()
  })

  it('says nothing when it worked', async () => {
    panel()
    await waitFor(() => expect(refreshes).toHaveLength(1))
    expect(document.querySelector('[data-auto-refresh-failed]')).toBeNull()
  })
})

describe('a table that did not ask', () => {
  it('is left alone however old it is', async () => {
    // Zero means "only when somebody presses the button", which is what every
    // source in this product did before there was an alternative.
    source = { ...base, refreshIntervalSeconds: 0, lastRefreshedAt: '2026-08-01T00:00:00.000Z' }
    panel()
    await screen.findByRole('button', { name: '刷新' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(refreshes).toEqual([])
  })

  it('still says out loud that its rows are old', async () => {
    // Not refreshing is a choice; hiding the age is not part of it.
    source = { ...base, refreshIntervalSeconds: 0, lastRefreshedAt: '2026-08-01T00:00:00.000Z' }
    panel()
    expect(await screen.findByText(/天前刷新/)).toBeDefined()
  })
})

describe('a table nobody fetches', () => {
  it('is never refreshed on opening', async () => {
    source = { ...base, sourceKind: 'local', http: undefined, keyColumn: null, refreshIntervalSeconds: 0 }
    panel()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(refreshes).toEqual([])
  })
})
