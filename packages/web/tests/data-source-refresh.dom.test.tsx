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
import { DataSourceBinding } from '../src/editor/data-source-binding.tsx'

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

describe('when a refresh brings nothing back', () => {
  it('keeps showing the rows that are already here', async () => {
    // The promise: an external service being down means the data is not the
    // newest, not that the feature is broken.
    refreshReply = { outcome: 'failed', reason: 'unreachable' }
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))

    await screen.findByText(/连不上 Google/)
    // The row count still stands: nothing was replaced.
    expect(screen.getByText(/2 行/)).toBeDefined()
    expect(screen.getByText(/仍可用它打印/)).toBeDefined()
  })

  it('names the reason rather than saying it failed', async () => {
    // "Not shared any more" and "Google is down" lead an operator to two
    // completely different next actions.
    refreshReply = { outcome: 'failed', reason: 'notShared' }
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '刷新' }))
    expect(await screen.findByText(/不再分享给本机/)).toBeDefined()
  })

  it('leaves the control usable, so it can be tried again', async () => {
    refreshReply = { outcome: 'failed', reason: 'rateLimited' }
    render(wrap(<DataSourcesPage />))
    const control = await screen.findByRole('button', { name: '刷新' })
    fireEvent.click(control)

    await screen.findByText(/暂时拒绝/)
    expect((screen.getByRole('button', { name: '刷新' }) as HTMLButtonElement).disabled).toBe(false)
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

describe('refreshing from the design editor', () => {
  it('is offered beside the columns a design references', async () => {
    // The column names in that panel are what a design writes in `${}`. Add a
    // column in Google with the editor open and, without this, the only way to
    // see it is to leave, refresh elsewhere, and come back — by which point
    // somebody has probably typed the name from memory, which is a reference
    // that resolves to nothing.
    render(
      wrap(
        <DataSourceBinding dataSourceId="ds-1" onChange={() => undefined} bindingIssue={null} />,
      ),
    )
    expect(await screen.findByRole('button', { name: '刷新' })).toBeDefined()
  })

  it('says how fresh those column names are', async () => {
    render(
      wrap(
        <DataSourceBinding dataSourceId="ds-1" onChange={() => undefined} bindingIssue={null} />,
      ),
    )
    await screen.findByRole('button', { name: '刷新' })
    expect(document.querySelector('[data-binding-freshness]')?.textContent).toMatch(/上次刷新/)
  })

  it('is not offered for a table maintained here', async () => {
    sources = [{ ...LOCAL, id: 'ds-1' }]
    render(
      wrap(
        <DataSourceBinding dataSourceId="ds-1" onChange={() => undefined} bindingIssue={null} />,
      ),
    )
    await screen.findByText(/列/)
    expect(screen.queryByRole('button', { name: '刷新' })).toBeNull()
  })
})
