/**
 * The controls above the row list: page selection, viewing order, pagination.
 *
 * The one that needs care is the order toggle. Printing is always by ascending
 * row number — that is what makes a reprint line up and lets somebody check a
 * stack of labels against the spreadsheet — so a control offering "descending"
 * must not leave anybody thinking the labels come out backwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RowSelectionPanel } from '../src/features/print/row-selection.tsx'
import { EMPTY, type Selection } from '../src/features/print/selection.ts'

const TOTAL = 25
let requested: string[]

const SOURCE = {
  id: 'ds-1', name: '订单表', columns: ['订单号'], rowCount: TOTAL,
  sourceKind: 'local', createdAt: 'T', updatedAt: 'T',
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
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
  requested = []
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/rows')) {
      requested.push(url)
      const params = new URL(url, 'http://x').searchParams
      const page = Number(params.get('page') ?? 1)
      const size = Number(params.get('pageSize') ?? 10)
      const desc = params.get('order') === 'desc'
      // Mirrors the server: descending page one is the END of the table, not
      // the first page upside down.
      const all = Array.from({ length: TOTAL }, (_u, i) => i + 1)
      const ordered = desc ? [...all].reverse() : all
      const rows = ordered
        .slice((page - 1) * size, page * size)
        .map((ordinal) => ({ ordinal, values: { 订单号: `A-${ordinal}` } }))
      return json({ rows, page, pageSize: size, total: TOTAL })
    }
    return json({ dataSources: [SOURCE] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Render with a selection that the test can read back. */
function panel(initial: Selection = EMPTY): { current: () => Selection } {
  let selection = initial
  const box = { current: () => selection }
  function Harness(): React.JSX.Element {
    const [value, setValue] = [selection, (next: Selection) => {
      selection = next
      rerender()
    }]
    return (
      <RowSelectionPanel dataSourceId="ds-1" selection={value} onChange={setValue} copies={1} />
    )
  }
  const { rerender: doRerender } = render(wrap(<Harness />))
  function rerender(): void {
    doRerender(wrap(<Harness />))
  }
  return box
}

describe('pagination', () => {
  it('uses the pagination control rather than bare prev/next', async () => {
    panel()
    await screen.findByText('A-1')
    expect(document.querySelector('[data-pagination]')).not.toBeNull()
  })

  it('offers the last page directly, without clicking through', async () => {
    // 25 rows, ten to a page: three pages. Reaching the end of a long table
    // should not be a sequence of clicks.
    panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }))
    await screen.findByText('A-21')
  })

  it('marks the page in view for a screen reader', async () => {
    panel()
    await screen.findByText('A-1')
    expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('selecting the page in view', () => {
  it('ticks every row on it', async () => {
    const state = panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '选中本页' }))

    await waitFor(() => expect(state.current()).toEqual({
      kind: 'explicit',
      ordinals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    }))
  })

  it('adds to the previous page rather than replacing it', async () => {
    // Otherwise paging forward and ticking twice loses the first page, and the
    // count at the top is the only thing that would have said so.
    const state = panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '选中本页' }))
    fireEvent.click(screen.getByRole('button', { name: '第 2 页' }))
    await screen.findByText('A-11')
    fireEvent.click(screen.getByRole('button', { name: '选中本页' }))

    await waitFor(() => {
      const current = state.current()
      expect(current.kind === 'explicit' && current.ordinals).toHaveLength(20)
    })
  })

  it('turns into an untick once the page is wholly chosen', async () => {
    const state = panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '选中本页' }))

    const undo = await screen.findByRole('button', { name: '取消本页' })
    fireEvent.click(undo)
    await waitFor(() => expect(state.current()).toEqual({ kind: 'explicit', ordinals: [] }))
  })
})

describe('the viewing order', () => {
  it('asks the server for the other end of the table', async () => {
    // Not a client-side reverse: page one descending must be the last rows of
    // the table, not the first ten upside down.
    panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('radio', { name: '倒序' }))

    await screen.findByText('A-25')
    expect(requested.some((url) => url.includes('order=desc'))).toBe(true)
  })

  it('goes back to page one, since page three means different rows now', async () => {
    panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '第 3 页' }))
    await screen.findByText('A-21')

    fireEvent.click(screen.getByRole('radio', { name: '倒序' }))
    await screen.findByText('A-25')
    expect(screen.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
  })

  it('says the print order is unaffected, because "descending" invites the opposite reading', async () => {
    panel()
    await screen.findByText('A-1')
    expect(document.querySelector('[data-order-note]')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '倒序' }))
    const note = await screen.findByText(/打印一律按行号升序/)
    expect(note).toBeDefined()
  })

  it('keeps a selection made in one order when the order flips', async () => {
    // The selection is a set of row numbers; how they were listed is not part
    // of it.
    const state = panel()
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('button', { name: '选中本页' }))
    fireEvent.click(screen.getByRole('radio', { name: '倒序' }))
    await screen.findByText('A-25')

    const current = state.current()
    expect(current.kind === 'explicit' && current.ordinals).toEqual([1,2,3,4,5,6,7,8,9,10])
  })

  it('shows a row already chosen as ticked in the other order', async () => {
    const state = panel({ kind: 'explicit', ordinals: [25] })
    await screen.findByText('A-1')
    fireEvent.click(screen.getByRole('radio', { name: '倒序' }))

    const row = (await screen.findByText('A-25')).closest('tr')!
    expect(within(row).getByRole('checkbox').getAttribute('data-state')).toBe('checked')
    expect(state.current().kind).toBe('explicit')
  })
})
