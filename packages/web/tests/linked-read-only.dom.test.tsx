/**
 * A linked table, in the browser: read-only, and releasable.
 *
 * The read-only state prevents a specific silent loss — edit a cell, refresh,
 * and the edit is gone with nothing said. Unlinking is the way out, and its
 * confirmation has to say what it costs rather than ask "are you sure".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'
import { DataSourceEditor } from '../src/features/data-sources/data-source-editor.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'
import { giveElementsSize } from './support/layout.ts'

let sources: Array<Record<string, unknown>>
let unlinked: string[]

const LINKED = {
  id: 'ds-1', name: '本月出货', columns: ['订单号', '收件人'], rowCount: 2,
  sourceKind: 'google-sheets', spreadsheetId: 'sheet-1', spreadsheetTitle: '出货台账',
  worksheetId: 0, worksheetTitle: '本月出货', lastRefreshedAt: '2026-08-22T00:00:00.000Z',
  createdAt: 'T', updatedAt: 'T',
}

const LOCAL = {
  id: 'ds-2', name: '本地表', columns: ['a'], rowCount: 1,
  sourceKind: 'local', createdAt: 'T', updatedAt: 'T',
}

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
  sources = [LINKED, LOCAL]
  unlinked = []
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/unlink')) {
      unlinked.push(url)
      return json({ ...LINKED, sourceKind: 'local' })
    }
    if (url.includes('/google/status')) return json({ configured: true, clientEmail: 'r@example.com' })
    if (url.includes('/rows')) {
      return json({
        rows: [
          { ordinal: 1, values: { 订单号: 'A-001', 收件人: '张三' } },
          { ordinal: 2, values: { 订单号: 'A-002', 收件人: '李四' } },
        ],
        page: 1, pageSize: 10_000, total: 2,
      })
    }
    return json({ dataSources: sources })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the list page', () => {
  it('does not offer to replace a linked table', async () => {
    // Replacing is an edit, and the next refresh would undo it silently.
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本月出货')

    const card = screen.getByText('本月出货').closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).queryByRole('button', { name: '替换' })).toBeNull()
  })

  it('still offers it for a table maintained here', async () => {
    render(wrap(<DataSourcesPage />))
    const card = (await screen.findByText('本地表')).closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).getByRole('button', { name: '替换' })).toBeDefined()
  })

  it('offers a linked table for viewing, not for editing', async () => {
    // The button used to say 编辑 for both kinds. For a linked table it opens a
    // grid nothing can be typed into — the label promised something the page
    // then refused, and the only way to find out was to click it.
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本月出货')

    const card = screen.getByText('本月出货').closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).getByRole('button', { name: '查看' })).toBeDefined()
    expect(within(card as HTMLElement).queryByRole('button', { name: '编辑' })).toBeNull()
  })

  it('still offers a local table for editing', async () => {
    render(wrap(<DataSourcesPage />))
    const card = (await screen.findByText('本地表')).closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).getByRole('button', { name: '编辑' })).toBeDefined()
  })

  it('links straight to the spreadsheet it came from', async () => {
    // Checking the source of a number means going to Google, and copying the
    // id out of a refresh dialog to build the address by hand is not a thing
    // anybody should do twice.
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本月出货')

    const card = screen.getByText('本月出货').closest('[class*="rounded"]')!
    const link = within(card as HTMLElement).getByRole('link', { name: '在 Google 中打开' })
    // gid=0 is the first worksheet — and 0 is falsy, which is how it goes
    // missing and lands everybody on whichever tab Google opens by default.
    expect(link.getAttribute('href')).toBe(
      'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('has no such link for a local table', async () => {
    render(wrap(<DataSourcesPage />))
    const card = (await screen.findByText('本地表')).closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).queryByRole('link')).toBeNull()
  })

  it('offers to unlink, and says what that costs', async () => {
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本月出货')

    fireEvent.click(screen.getByRole('button', { name: '解除链接' }))
    const dialog = await screen.findByRole('alertdialog')
    // Not "are you sure": what stops working, and what is kept.
    expect(within(dialog).getByText(/不能再从 Google 刷新/)).toBeDefined()
    expect(within(dialog).getByText(/行会全部保留/)).toBeDefined()
  })

  it('unlinks once confirmed', async () => {
    render(wrap(<DataSourcesPage />))
    await screen.findByText('本月出货')

    fireEvent.click(screen.getByRole('button', { name: '解除链接' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '解除并接管' }))

    await waitFor(() => expect(unlinked).toHaveLength(1))
    expect(unlinked[0]).toContain('/data-sources/ds-1/unlink')
  })

  it('does not offer to unlink a table that was never linked', async () => {
    render(wrap(<DataSourcesPage />))
    const card = (await screen.findByText('本地表')).closest('[class*="rounded"]')!
    expect(within(card as HTMLElement).queryByRole('button', { name: '解除链接' })).toBeNull()
  })
})

describe('the editor', () => {
  let restoreSize: () => void
  beforeEach(() => {
    restoreSize = giveElementsSize()
  })
  afterEach(() => restoreSize())

  it('says the table is read-only and why', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('本月出货')
    expect(screen.getByText(/在本机只读/)).toBeDefined()
  })

  it('does not offer to add rows to a linked table', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('本月出货')
    expect(screen.queryByRole('button', { name: '加行' })).toBeNull()
  })

  it('leaves a local table fully editable', async () => {
    // The execution path: a guard hard-coded to always refuse would pass every
    // assertion above and fail this one.
    sources = [{ ...LOCAL, id: 'ds-1', name: '本地表', columns: ['a'] }]
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('本地表')

    expect(screen.getByRole('button', { name: '加行' })).toBeDefined()
    expect(screen.queryByText(/在本机只读/)).toBeNull()
  })

  it('does not show edit controls that can never do anything', async () => {
    // The same complaint as the button label, one screen further in: a
    // read-only grid can never become dirty, so undo, redo, discard and save
    // sat there permanently greyed out. A control that can never work is not a
    // disabled control, it is a wrong one.
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('本月出货')

    for (const name of ['撤销', '重做', '取消修改', '保存']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('keeps what a linked table does support', async () => {
    // Refreshing is the whole point of a linked table.
    render(wrap(<DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />))
    await screen.findByText('本月出货')
    expect(screen.getByRole('button', { name: /刷新/ })).toBeDefined()
  })

  it('still shows them for a local table', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-2" tabId="tab-2" />))
    expect(await screen.findByRole('button', { name: '保存' })).toBeDefined()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDefined()
  })
})
