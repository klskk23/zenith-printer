import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'
import { DataSourceEditor } from '../src/features/data-sources/data-source-editor.tsx'

/**
 * Render assertions for the two pages this feature adds.
 *
 * Constitution Principle II: every navigable page needs one. The project once
 * shipped a blank designer behind 929 green tests because none of them mounted
 * a component — these exist so that cannot happen twice.
 */
const SOURCE = {
  id: 'ds-1',
  name: '订单表',
  columns: ['订单号', '收件人'],
  rowCount: 12,
  createdAt: 'T',
  updatedAt: 'T',
}

const ROWS = Array.from({ length: 10 }, (_unused, i) => ({
  ordinal: i + 1,
  values: { 订单号: `A-${i + 1}`, 收件人: `收件人${i + 1}` },
}))

let sources: Array<typeof SOURCE>
let patched: Array<Record<string, unknown>>

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  sources = [SOURCE]
  patched = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        } as unknown as Response)

      if (url.includes('/rows') && init?.method === 'PATCH') {
        patched.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return json(SOURCE)
      }
      if (url.includes('/rows')) {
        return json({ rows: ROWS, page: 1, pageSize: 10, total: 12 })
      }
      return json({ dataSources: sources })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the data source list', () => {
  it('mounts without throwing', () => {
    expect(() => render(wrap(<DataSourcesPage />))).not.toThrow()
    expect(document.querySelector('[data-data-sources-page]')).not.toBeNull()
  })

  it('offers a way in when there is nothing yet', async () => {
    sources = []
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByText(/还没有数据源/)).toBeDefined()
    expect(screen.getByRole('button', { name: '上传 CSV' })).toBeDefined()
  })

  it('shows the row count and the column names, which are what get referenced', async () => {
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByText('订单表')).toBeDefined()
    expect(screen.getByText('12 行')).toBeDefined()
    expect(screen.getByText(/订单号、收件人/)).toBeDefined()
  })

  it('opens the table it was asked to open', async () => {
    const opened: string[] = []
    render(wrap(<DataSourcesPage onOpen={(id) => opened.push(id)} />))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    expect(opened).toEqual(['ds-1'])
  })

  it('warns about the rows, not about who is using the table', async () => {
    // Deleting is confirmed for what it destroys. A design left dangling is
    // recoverable by rebinding, so it does not gate the delete (FR-028).
    render(wrap(<DataSourcesPage />))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByText(/表里的行会被删掉，无法恢复/)).toBeDefined()
  })
})

describe('the table editor', () => {
  it('mounts without throwing', () => {
    expect(() => render(wrap(<DataSourceEditor dataSourceId="ds-1" />))).not.toThrow()
  })

  it('renders the header and the first page of rows', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    expect(await screen.findByText('收件人')).toBeDefined()
    expect(screen.getAllByRole('row')).toHaveLength(11) // header + ten rows
  })

  it('shows the ordinals, which are what a 5-12 range refers to', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    await screen.findByText('收件人')
    expect(screen.getByLabelText('1 收件人')).toBeDefined()
    expect(screen.getByLabelText('10 收件人')).toBeDefined()
  })

  it('says how to paste, since nothing on screen suggests it', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    expect(await screen.findByText(/Ctrl\+V/)).toBeDefined()
  })

  it('pages ten rows at a time', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    expect(await screen.findByText('第 1 页 / 共 2 页')).toBeDefined()
  })

  it('sends only the cell that changed', async () => {
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    const cell = (await screen.findByLabelText('2 收件人')) as HTMLInputElement
    fireEvent.change(cell, { target: { value: '王五' } })
    fireEvent.blur(cell)

    await vi.waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ upserts: [{ ordinal: 2, values: { 收件人: '王五' } }] })
  })

  it('does not send anything when a cell is left unchanged', async () => {
    // Otherwise tabbing across a row rewrites every cell it passes.
    render(wrap(<DataSourceEditor dataSourceId="ds-1" />))
    const cell = await screen.findByLabelText('2 收件人')
    fireEvent.focus(cell)
    fireEvent.blur(cell)
    expect(patched).toHaveLength(0)
  })
})
