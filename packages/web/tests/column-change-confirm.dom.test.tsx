/**
 * Confirming a header change before it is applied.
 *
 * The dialog exists because losing a column silently breaks designs in a way
 * that only shows on a printed label. Cancelling has to leave everything as it
 * was; applying has to actually apply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'

let refreshCalls: Array<Record<string, unknown>>
let reply: Record<string, unknown>

const LINKED = {
  id: 'ds-1', name: '本月出货', columns: ['订单号', '收件人'], rowCount: 2,
  sourceKind: 'google-sheets', spreadsheetId: 'sheet-1', spreadsheetTitle: '出货台账',
  worksheetId: 0, worksheetTitle: '本月出货', lastRefreshedAt: 'T', createdAt: 'T', updatedAt: 'T',
}

const NEEDS_CONFIRMATION = {
  outcome: 'needsConfirmation',
  removedColumns: ['收件人'],
  addedColumns: ['客户名称'],
  affectedTemplates: [{ id: 'tpl-1', name: '出货面单' }],
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  refreshCalls = []
  reply = NEEDS_CONFIRMATION
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/refresh')) {
      refreshCalls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return json(reply)
    }
    if (url.includes('/google/status')) return json({ configured: true, clientEmail: 'r@example.com' })
    return json({ dataSources: [LINKED] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function triggerChange(): Promise<void> {
  render(wrap(<DataSourcesPage />))
  fireEvent.click(await screen.findByRole('button', { name: '刷新' }))
  await screen.findByText('这张表的列变了')
}

describe('the confirmation', () => {
  it('names the columns that went', async () => {
    await triggerChange()
    expect(screen.getByText(/消失的列：收件人/)).toBeDefined()
  })

  it('names the columns that arrived', async () => {
    await triggerChange()
    expect(screen.getByText(/新增的列：客户名称/)).toBeDefined()
  })

  it('lists the designs that would stop resolving', async () => {
    await triggerChange()
    expect(screen.getByText('出货面单')).toBeDefined()
  })

  it('explains why a rename looks like a deletion', async () => {
    // Otherwise the dialog reads as a bug: somebody renamed one column and is
    // being told a column was deleted and another created.
    await triggerChange()
    expect(screen.getByText(/分不清「改名」和「删一列再加一列」/)).toBeDefined()
  })

  it('says so when no design is affected, and still asks', async () => {
    reply = { ...NEEDS_CONFIRMATION, affectedTemplates: [] }
    await triggerChange()
    expect(screen.getByText(/目前没有设计引用消失的列/)).toBeDefined()
    expect(screen.getByRole('button', { name: '仍然应用' })).toBeDefined()
  })

  it('sends nothing more when cancelled', async () => {
    await triggerChange()
    fireEvent.click(screen.getByRole('button', { name: '先不应用' }))

    await waitFor(() => expect(screen.queryByText('这张表的列变了')).toBeNull())
    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]).toEqual({})
  })

  it('resends with the confirmation when applied', async () => {
    await triggerChange()
    reply = { outcome: 'applied', rowsBefore: 2, rowsAfter: 2, columnsAdded: ['客户名称'], lastRefreshedAt: 'T2' }
    fireEvent.click(screen.getByRole('button', { name: '仍然应用' }))

    await waitFor(() => expect(refreshCalls).toHaveLength(2))
    // A second read, not a stored decision: the sheet may have changed again,
    // and it is the second read that gets written.
    expect(refreshCalls[1]).toEqual({ confirmColumnChange: true })
  })

  it('closes once applied', async () => {
    await triggerChange()
    reply = { outcome: 'applied', rowsBefore: 2, rowsAfter: 2, columnsAdded: [], lastRefreshedAt: 'T2' }
    fireEvent.click(screen.getByRole('button', { name: '仍然应用' }))

    await waitFor(() => expect(screen.queryByText('这张表的列变了')).toBeNull())
  })
})
