import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RowSelectionPanel } from '../src/features/print/row-selection.tsx'
import { EMPTY, type Selection } from '../src/features/print/selection.ts'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'

/**
 * Choosing rows in the print dialog.
 *
 * The assertions that matter are about what the control *means*: a select-all
 * that quietly covers one page prints ten labels when somebody asked for two
 * hundred, and there is nothing on screen to say which one happened.
 */
const TOTAL = 200

const SOURCE = {
  id: 'ds-1',
  name: '订单表',
  columns: ['订单号', '收件人'],
  rowCount: TOTAL,
  createdAt: 'T',
  updatedAt: 'T',
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      const json = (body: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        } as unknown as Response)

      if (url.includes('/rows')) {
        // Honours pageSize, like the server does. A stub that always returned
        // ten rows could not reproduce the reported bug, which was two
        // requests for the same page at different sizes colliding in the cache.
        const page = Number(/page=(\d+)/.exec(url)?.[1] ?? 1)
        const pageSize = Number(/pageSize=(\d+)/.exec(url)?.[1] ?? 10)
        const rows = Array.from({ length: pageSize }, (_unused, i) => {
          const ordinal = (page - 1) * pageSize + i + 1
          return { ordinal, values: { 订单号: `A-${ordinal}`, 收件人: `收件人${ordinal}` } }
        })
        return json({ rows, page, pageSize, total: TOTAL })
      }
      if (url.includes('/preflight')) {
        return json({ warnings: [] })
      }
      if (url.includes('/preview')) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
          blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
        } as unknown as Response)
      }
      return json({ dataSources: [SOURCE] })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function panel(selection: Selection = EMPTY, copies = 1) {
  const changes: Selection[] = []
  render(
    wrap(
      <RowSelectionPanel
        dataSourceId="ds-1"
        selection={selection}
        onChange={(next) => changes.push(next)}
        copies={copies}
      />,
    ),
  )
  return changes
}

describe('the panel', () => {
  it('mounts without throwing', () => {
    expect(() => panel()).not.toThrow()
    expect(document.querySelector('[data-row-selection]')).not.toBeNull()
  })

  it('shows ten rows a page', async () => {
    panel()
    await screen.findByText('收件人1')
    // header + ten rows
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })

  it('pages forward', async () => {
    panel()
    await screen.findByText('收件人1')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('收件人11')).toBeDefined()
  })
})

describe('select-all', () => {
  it('says how many rows it means, on the button', async () => {
    // Without the count this is the control that quietly means "this page".
    panel()
    expect(await screen.findByRole('button', { name: '全选（200 行）' })).toBeDefined()
  })

  it('selects the whole table, not the visible page', async () => {
    const changes = panel()
    fireEvent.click(await screen.findByRole('button', { name: '全选（200 行）' }))
    expect(changes[0]).toEqual({ kind: 'all' })
  })

  it('counts the whole table in the summary', async () => {
    panel({ kind: 'all' }, 2)
    expect(await screen.findByText('已选 200 行，共 400 张')).toBeDefined()
  })

  it('ticks every visible row when everything is selected', async () => {
    panel({ kind: 'all' })
    await screen.findByText('收件人1')
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.every((box) => box.getAttribute('data-state') === 'checked')).toBe(true)
  })
})

describe('typing a range', () => {
  it('selects the rows a 5-12 range names, inclusive of both ends', async () => {
    const changes = panel()
    fireEvent.change(await screen.findByLabelText('行区间'), { target: { value: '5-12' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    expect(changes[0]).toEqual({ kind: 'explicit', ordinals: [5, 6, 7, 8, 9, 10, 11, 12] })
  })

  it('says the range is unreadable rather than selecting nothing', async () => {
    const changes = panel()
    fireEvent.change(await screen.findByLabelText('行区间'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    expect(changes).toHaveLength(0)
    expect(document.querySelector('[data-range-invalid]')).not.toBeNull()
  })

  it('refuses a range that runs past the end of the table', async () => {
    const changes = panel()
    fireEvent.change(await screen.findByLabelText('行区间'), { target: { value: '5-999' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(changes).toHaveLength(0)
  })
})

describe('ticking rows', () => {
  it('adds the row it was told to add', async () => {
    const changes = panel()
    await screen.findByText('收件人1')
    fireEvent.click(screen.getByLabelText('行号 3'))
    expect(changes[0]).toEqual({ kind: 'explicit', ordinals: [3] })
  })

  it('unticking one row while everything is selected keeps the other 199', async () => {
    const changes = panel({ kind: 'all' })
    await screen.findByText('收件人1')
    fireEvent.click(screen.getByLabelText('行号 3'))

    expect(changes[0]?.kind).toBe('explicit')
    expect(changes[0]).toMatchObject({ ordinals: expect.not.arrayContaining([3]) })
    expect((changes[0] as { ordinals: number[] }).ordinals).toHaveLength(199)
  })
})

describe('what the panel says out loud', () => {
  it('warns that content width is not checked per row', async () => {
    // Silence here reads as "checked, and fine". It is not checked at all —
    // encoding every row to measure it is what FR-045 rules out (FR-045a).
    panel({ kind: 'all' })
    expect(await screen.findByText(/未按行检查内容宽度/)).toBeDefined()
  })

  it('says nothing is selected rather than showing a zero', async () => {
    panel()
    expect(await screen.findByText(/一行都没选/)).toBeDefined()
  })
})

describe('the first page, before anything is clicked', () => {
  /**
   * The reported bug: the panel opened showing one row, and ten only appeared
   * after paging forward and back.
   *
   * Reproduced through the real dialog rather than a stand-in, because the
   * cause was the *combination* — the dialog fetches one row purely to read the
   * table's total, and that request shared a cache key with the panel's ten-row
   * request. A synthetic component with the same two hooks does not reproduce
   * it; the ordering only comes out through the component that actually ships.
   */
  const PRINTER = {
    id: 'prn-1',
    name: 'w',
    kind: 'niimbot',
    capabilities: { model: 'B3S_P', dpi: 203, printheadPixels: 576 },
    queueState: 'running',
  }

  const IR = { widthMm: 50, heightMm: 30, dpi: 203, elements: [] }

  it('shows ten rows the moment the dialog opens', async () => {
    render(
      wrap(
        <PrintDialog
          ir={IR as never}
          templateId="tpl-1"
          profileId={null}
          printer={PRINTER as never}
          variableValues={{}}
          unresolved={[]}
          dataSourceId="ds-1"
          onClose={() => undefined}
        />,
      ),
    )

    await screen.findByText('收件人1')
    // Header plus ten. One row here is the bug.
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })

  it('reads the table total without spending a row request on it', async () => {
    // The count is already on the data source; fetching a page to read it is
    // both a wasted request and what caused the collision.
    render(
      wrap(
        <PrintDialog
          ir={IR as never}
          templateId="tpl-1"
          profileId={null}
          printer={PRINTER as never}
          variableValues={{}}
          unresolved={[]}
          dataSourceId="ds-1"
          onClose={() => undefined}
        />,
      ),
    )

    await screen.findByText('收件人1')
    const sizes = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/rows'))
      .map((url) => /pageSize=(\d+)/.exec(url)?.[1])
    expect(sizes).not.toContain('1')
  })
})

describe('under StrictMode, which is how the app actually runs', () => {
  /**
   * `main.tsx` wraps the app in `<StrictMode>`; no test did. StrictMode mounts,
   * unmounts and remounts every component, which is exactly the sequence that
   * catches state living outside React — and TanStack Table v9 keeps its state
   * in a store rather than in React.
   */
  it('shows ten rows on the first render', async () => {
    render(
      <StrictMode>
        {wrap(
          <RowSelectionPanel
            dataSourceId="ds-1"
            selection={EMPTY}
            onChange={() => undefined}
            copies={1}
          />,
        )}
      </StrictMode>,
    )

    await screen.findByText('收件人1')
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })
})
