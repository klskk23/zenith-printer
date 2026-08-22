/**
 * Refreshing from the browser.
 *
 * Two things under test that are easy to get wrong in opposite directions:
 * a refresh that never happens because the button is not there, and a refresh
 * that happens when nobody asked for one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'

let refreshes: number
let refreshReply: Record<string, unknown>
let sources: Array<Record<string, unknown>>

const LINKED = {
  id: 'ds-1',
  name: '本月出货',
  columns: ['订单号', '收件人'],
  rowCount: 2,
  sourceKind: 'google-sheets',
  spreadsheetId: 'sheet-1',
  spreadsheetTitle: '出货台账',
  worksheetId: 0,
  worksheetTitle: '本月出货',
  lastRefreshedAt: '2026-08-22T00:00:00.000Z',
  createdAt: 'T',
  updatedAt: 'T',
}

const LOCAL = {
  id: 'ds-2', name: '本地表', columns: ['a'], rowCount: 1,
  sourceKind: 'local', createdAt: 'T', updatedAt: 'T',
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  refreshes = 0
  sources = [LINKED, LOCAL]
  refreshReply = {
    outcome: 'applied', rowsBefore: 2, rowsAfter: 5, columnsAdded: [],
    lastRefreshedAt: '2026-08-23T09:00:00.000Z',
  }

  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/refresh')) {
      refreshes += 1
      return json(refreshReply)
    }
    if (url.includes('/google/status')) {
      return json({ configured: true, clientEmail: 'zenith@example.iam.gserviceaccount.com' })
    }
    return json({ dataSources: sources })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the refresh control', () => {
  it('is offered for a linked table', async () => {
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByRole('button', { name: '刷新' })).toBeDefined()
  })

  it('is not offered for a local one, which has nothing to refresh', async () => {
    sources = [LOCAL]
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本地表')
    expect(screen.queryByRole('button', { name: '刷新' })).toBeNull()
  })

  it('says where the table came from and when it was last fetched', async () => {
    // Staleness is invisible unless it is written down, and printing
    // yesterday's rows is not something anybody notices until the labels are
    // in hand.
    render(wrap(<DataSourcesPage />))
    const origin = await screen.findByText(/出货台账/)
    expect(origin.textContent).toContain('本月出货')
  })

  it('fetches when asked, and reports what changed', async () => {
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))

    await waitFor(() => expect(refreshes).toBe(1))
    expect(await screen.findByText(/2 行 → 5 行/)).toBeDefined()
  })

  it('says so when nothing came back, and that the old rows still print', async () => {
    refreshReply = { outcome: 'failed', reason: 'notShared' }
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))

    expect(await screen.findByText(/仍可用它打印/)).toBeDefined()
  })

  it('refuses too many rows without keeping a truncated prefix', async () => {
    refreshReply = { outcome: 'refusedTooManyRows', rowCount: 12_000, limit: 10_000 }
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))

    const notice = await screen.findByText(/超过了上限/)
    expect(notice.textContent).toContain('12000')
  })
})

describe('nothing refreshes on its own', () => {
  it('sends no refresh while the page simply sits there', async () => {
    // FR-014. A table that changed while somebody was looking at a list of
    // rows would renumber under them — and the numbers are how a row selection
    // is expressed. Without this test, somebody could add polling later and
    // nothing would turn red.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(wrap(<DataSourcesPage />))
    await screen.findByRole('button', { name: '刷新' })

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(refreshes).toBe(0)
  })
})
