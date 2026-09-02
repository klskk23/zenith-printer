/**
 * A refresh that adds columns has to reach the grid.
 *
 * A ledger source is created knowing only its key column — the columns are
 * whatever the ledger reports on the first read. So the first refresh of a new
 * source almost always changes the column set, and until it is shown the table
 * looks like it has one column and nothing in it.
 *
 * Reported from a deployment: connect a category, open it, press refresh. The
 * banner says which columns were added, the list page shows all of them, and
 * the grid keeps showing `sys_id` alone until the page is reloaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourceEditor } from '../src/features/data-sources/data-source-editor.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'
import { giveElementsSize } from './support/layout.ts'

const ONE_COLUMN = {
  id: 'ds-1', name: 'FancyWAN', columns: ['sys_id'], rowCount: 0,
  sourceKind: 'nexus', nexus: { categoryId: 'cat-empty' }, keyColumn: 'sys_id',
  refreshIntervalSeconds: 0, refreshBeforePrint: false,
  lastRefreshedAt: null, createdAt: 'T', updatedAt: 'T',
}

const EIGHT = ['sys_id', 'sys_sn', 'sys_category', 'sys_status']

let sources: Array<Record<string, unknown>>
let restoreSize: () => void

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  restoreSize = giveElementsSize()
  sources = [ONE_COLUMN]
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/refresh') && init?.method === 'POST') {
      // What the server does on a first read: the ledger's columns replace the
      // lone key column the source was created with.
      sources = [{ ...ONE_COLUMN, columns: EIGHT, lastRefreshedAt: '2026-09-02T00:00:00.000Z' }]
      return json({
        outcome: 'applied', rowsBefore: 0, rowsAfter: 0,
        columnsAdded: EIGHT.slice(1), added: 0, updated: 0, removed: 0,
        lastRefreshedAt: '2026-09-02T00:00:00.000Z',
      })
    }
    if (url.includes('/google/status')) return json({ configured: false, clientEmail: null })
    if (url.includes('/rows')) return json({ rows: [], page: 1, pageSize: 10_000, total: 0 })
    return json({ dataSources: sources })
  }))
})

afterEach(() => {
  cleanup()
  restoreSize()
  vi.unstubAllGlobals()
})

/** The column titles the grid is actually drawing, without the row-number gutter. */
const headers = (): string[] =>
  [...document.querySelectorAll('.dsg-cell-header-container')]
    .map((cell) => (cell.textContent ?? '').trim())
    .filter((title) => title.length > 0)

describe('opening a table nobody has read yet', () => {
  it('reads it, without waiting to be asked', async () => {
    /**
     * Connecting a table is the request to read it — nobody connects one in
     * order not to see it. Before this, a newly connected ledger category sat
     * at zero rows and one column until somebody found the refresh button,
     * which looked exactly like a category with nothing in it.
     */
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('FancyWAN')
    await waitFor(() => expect(headers()).toEqual(EIGHT))
  })

  it('reads it once, not once per render', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await waitFor(() => expect(headers()).toEqual(EIGHT))
    await new Promise((resolve) => setTimeout(resolve, 60))

    const refreshes = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/refresh') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(refreshes).toHaveLength(1)
  })
})

describe('a first refresh that brings the columns', () => {
  it('shows the rest once the refresh has brought them', async () => {
    // Already read once, so the automatic first read does not fire and the
    // grid starts from the single column — the state a pressed refresh has to
    // move it out of.
    sources = [{ ...ONE_COLUMN, lastRefreshedAt: '2026-09-01T00:00:00.000Z' }]
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('FancyWAN')
    await waitFor(() => expect(headers()).toEqual(['sys_id']))

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    // The banner already says the columns arrived; the grid is what somebody
    // actually reads, and it was the half that did not update.
    await screen.findByText(/新增了列/)
    await waitFor(() => expect(headers()).toEqual(EIGHT))
  })
})
