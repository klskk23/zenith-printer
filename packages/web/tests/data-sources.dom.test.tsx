import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'
import { DataSourceEditor } from '../src/features/data-sources/data-source-editor.tsx'
import { TabBar } from '../src/app/tab-bar.tsx'
import { giveElementsSize } from './support/layout.ts'
import { gridValues } from './support/grid.ts'
import { copy } from '../src/i18n/index.ts'
import { WorkspaceProvider, useWorkspace } from '../src/app/workspace.tsx'
import { useEffect } from 'react'

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
/**
 * The rows, as the server would hold them.
 *
 * Stateful on purpose. A stub that returned the same rows whatever was PATCHed
 * could not tell an undo that worked from one that silently did nothing —
 * before and after would compare equal either way.
 */
let patchFails = false
let serverRows: Array<{ ordinal: number; values: Record<string, string> }>

function applyPatch(body: {
  upserts?: Array<{ ordinal: number; values: Record<string, string> }>
  deletes?: number[]
}): void {
  const byOrdinal = new Map(serverRows.map((row) => [row.ordinal, row.values]))
  for (const ordinal of body.deletes ?? []) {
    byOrdinal.delete(ordinal)
  }
  for (const upsert of body.upserts ?? []) {
    byOrdinal.set(upsert.ordinal, { ...(byOrdinal.get(upsert.ordinal) ?? {}), ...upsert.values })
  }
  // Renumbered contiguously, as the repository does.
  serverRows = [...byOrdinal.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, values], index) => ({ ordinal: index + 1, values }))
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  sources = [SOURCE]
  patched = []
  patchFails = false
  serverRows = ROWS.map((row) => ({ ordinal: row.ordinal, values: { ...row.values } }))
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
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patched.push(body)
        if (patchFails) {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ what: 'x', why: 'y', next: 'z' }),
            text: () => Promise.resolve('{}'),
          } as unknown as Response)
        }
        applyPatch(body as never)
        return json({ ...SOURCE, rowCount: serverRows.length })
      }
      if (url.includes('/rows')) {
        return json({ rows: serverRows, page: 1, pageSize: 10_000, total: serverRows.length })
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
  it('mounts and actually renders something', async () => {
    expect(() => render(wrap(<DataSourcesPage />))).not.toThrow()
    expect(document.querySelector('[data-data-sources-page]')).not.toBeNull()
    expect(await screen.findByText('订单表')).toBeDefined()
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
  /**
   * It is a spreadsheet now, not a form. The cell inputs exist but are
   * `tabIndex=-1`: the grid owns the cursor and the clipboard, which is what
   * makes range selection and Ctrl+V possible at all.
   */
  let restoreSize: () => void
  beforeEach(() => {
    restoreSize = giveElementsSize()
  })
  afterEach(() => restoreSize())

  function openEditor(): void {
    // The editor tells the workspace when it holds unsaved rows, so it needs a
    // real provider around it rather than a stub — that is the wiring which
    // makes the tab ask before closing.
    render(
      wrap(
        <WorkspaceProvider>
          <DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />
        </WorkspaceProvider>,
      ),
    )
  }

  const button = (name: string): HTMLButtonElement =>
    screen.getByRole('button', { name }) as HTMLButtonElement

  /** Add rows and wait for the toolbar to notice there is something to save. */
  async function addRow(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: '加行' }))
    await vi.waitFor(() => expect(button('保存').disabled).toBe(false))
  }

  it('mounts and actually renders something', async () => {
    // `not.toThrow()` alone is too weak: a component that renders nothing at
    // all passes it. That is not hypothetical — moving a hook below an early
    // return made this page render an empty div, and only assertions like the
    // ones below noticed.
    expect(() => openEditor()).not.toThrow()
    expect(await screen.findByText('订单表')).toBeDefined()
    expect(document.querySelector('[data-data-source-editor]')).not.toBeNull()
  })

  it('renders the column names as headers', async () => {
    openEditor()
    expect(await screen.findByText('收件人')).toBeDefined()
    expect(screen.getByText('订单号')).toBeDefined()
  })

  it('shows every row at once, with no paging', async () => {
    // Paging is what made copying a block across a page boundary impossible.
    openEditor()
    await screen.findByText('收件人')
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(10))
    expect(screen.queryByText(/第 1 页/)).toBeNull()
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
  })

  it('asks the server for the whole table, not a page of it', async () => {
    openEditor()
    await screen.findByText('收件人')
    const sizes = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/rows'))
      .map((url) => /pageSize=(\d+)/.exec(url)?.[1])
    expect(sizes).toContain('10000')
  })

  it('keeps cell inputs out of the tab order, so the grid owns the keyboard', async () => {
    // The old editor's focusable inputs are exactly why there was no cell
    // cursor, no range and nothing for Ctrl+C to copy.
    openEditor()
    await screen.findByText('收件人')
    const inputs = [...document.querySelectorAll('input.dsg-input')] as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((input) => input.tabIndex === -1)).toBe(true)
  })

  it('builds its add-rows bar from the application\'s own primitives', async () => {
    // The library ships one: an unstyled button and an English label, at the
    // foot of the page where it is impossible to miss.
    openEditor()
    await screen.findByText('收件人')
    expect(screen.getByRole('button', { name: '加行' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    expect(document.querySelector('[data-add-rows]')).not.toBeNull()
  })

  it('adds rows to the draft without sending anything yet', async () => {
    openEditor()
    await screen.findByText('收件人')
    const count = screen.getByLabelText('加几行') as HTMLInputElement
    fireEvent.change(count, { target: { value: '3' } })
    await addRow()

    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(13))
    // The point of staging: nothing has reached the server.
    expect(patched).toHaveLength(0)
  })

  it('keeps the count field editable while a longer number is typed', async () => {
    // Holding it as a number would snap "1" back over the first keystroke of
    // "10", making anything above nine impossible to enter.
    openEditor()
    await screen.findByText('收件人')
    const count = screen.getByLabelText('加几行') as HTMLInputElement
    fireEvent.change(count, { target: { value: '' } })
    expect(count.value).toBe('')
    fireEvent.change(count, { target: { value: '10' } })
    expect(count.value).toBe('10')
  })

  it('offers save and discard, inert until something has changed', async () => {
    openEditor()
    await screen.findByText('收件人')
    expect(button('保存').disabled).toBe(true)
    expect(button('取消修改').disabled).toBe(true)
    expect(screen.queryByText('有未保存的改动')).toBeNull()
  })

  it('says so while there are unsaved rows', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    expect(screen.getByText('有未保存的改动')).toBeDefined()
  })

  it('sends one patch when saved, not one per edit', async () => {
    // Three separate edits used to be three PATCHes; a mis-paste was already
    // the stored table before anybody could look at it.
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await addRow()
    await addRow()
    expect(patched).toHaveLength(0)

    fireEvent.click(button('保存'))
    await vi.waitFor(() => expect(patched).toHaveLength(1))
    const upserts = patched[0]?.upserts as Array<{ ordinal: number }>
    expect(upserts.map((u) => u.ordinal)).toEqual([11, 12, 13])
  })

  it('goes quiet again once the save lands', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    fireEvent.click(button('保存'))

    await vi.waitFor(() => expect(button('保存').disabled).toBe(true))
    expect(screen.queryByText('有未保存的改动')).toBeNull()
  })

  it('discards the draft and sends nothing', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))

    // Discarding is the one thing here that cannot be undone, so it asks
    // first. The confirm carries the same word as the button that opened it,
    // so it has to be found inside the dialog rather than on the page.
    fireEvent.click(button('取消修改'))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消修改' }))

    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(10))
    expect(patched).toHaveLength(0)
  })

  it('offers undo and redo, greyed out until there is something to undo', async () => {
    // A key combination as the only undo is no undo for anyone who does not
    // know it.
    openEditor()
    await screen.findByText('收件人')
    expect(button('撤销').disabled).toBe(true)
    expect(button('重做').disabled).toBe(true)
  })

  it('draws undo and redo the way the designer does', async () => {
    // Same action, two pages: a text button here and an icon button there
    // reads as two different features. The accessible name has to survive the
    // change to an icon, or the shortcut becomes the only way in.
    openEditor()
    await screen.findByText('收件人')

    for (const name of ['撤销', '重做']) {
      const control = button(name)
      expect(control.querySelector('svg')).not.toBeNull()
      expect(control.textContent).toBe('')
      expect(control.getAttribute('title')).not.toBe(null)
    }
  })

  it('undoes an edit without a round-trip', async () => {
    // Undo used to be a second PATCH trying to put the server back. Over a
    // draft it is local, so it costs nothing and cannot half-apply.
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))

    fireEvent.click(button('撤销'))
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(10))
    expect(patched).toHaveLength(0)
  })

  it('offers a redo once something has been undone, and puts the row back', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    fireEvent.click(button('撤销'))
    await vi.waitFor(() => expect(button('重做').disabled).toBe(false))

    fireEvent.click(button('重做'))
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))
  })

  it('undoes on Ctrl+Z', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))

    fireEvent.keyDown(document.querySelector('[data-data-source-editor]')!, {
      key: 'z',
      ctrlKey: true,
    })
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(10))
  })

  it('saves on Ctrl+S, which is what everybody presses', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()

    fireEvent.keyDown(document.querySelector('[data-data-source-editor]')!, {
      key: 's',
      ctrlKey: true,
    })
    await vi.waitFor(() => expect(patched).toHaveLength(1))
  })

  it('keeps the draft when the save fails', async () => {
    // The one outcome worse than an error is an error that also takes the
    // user's unsaved rows with it. The draft survives so Save can be pressed
    // again.
    patchFails = true
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))

    fireEvent.click(button('保存'))
    await vi.waitFor(() => expect(patched).toHaveLength(1))

    expect(await screen.findByText(copy.dataSources.patchFailed)).toBeDefined()
    expect(gridValues(2)).toHaveLength(11)
    expect(button('保存').disabled).toBe(false)
    expect(screen.getByText('有未保存的改动')).toBeDefined()
  })

  it('marks the tab dirty, which is what makes closing it ask first', async () => {
    // Without this the tab closes silently and the draft goes with it — the
    // editor is the only thing that knows the rows are unsaved.
    function Probe(): React.JSX.Element {
      const { tabs } = useWorkspace()
      return <span data-probe>{String(tabs.find((tab) => tab.id === 'tab-1')?.isDirty)}</span>
    }
    render(
      wrap(
        <WorkspaceProvider>
          <DataSourceEditor dataSourceId="ds-1" tabId="tab-1" />
          <Probe />
        </WorkspaceProvider>,
      ),
    )
    await screen.findByText('收件人')
    expect(document.querySelector('[data-probe]')?.textContent).toBe('false')

    await addRow()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-probe]')?.textContent).toBe('true'),
    )

    fireEvent.click(button('保存'))
    await vi.waitFor(() =>
      expect(document.querySelector('[data-probe]')?.textContent).toBe('false'),
    )
  })

  it('does not undo on a bare Z, which is a cell edit', async () => {
    openEditor()
    await screen.findByText('收件人')
    await addRow()
    await vi.waitFor(() => expect(gridValues(2)).toHaveLength(11))

    fireEvent.keyDown(document.querySelector('[data-data-source-editor]')!, { key: 'z' })
    expect(gridValues(2)).toHaveLength(11)
  })

  it('does not offer a per-row delete button any more', async () => {
    // Rows are removed from the right-click menu, like a spreadsheet; a
    // button per row was the form-shaped version of this page.
    openEditor()
    await screen.findByText('收件人')
    expect(screen.queryByRole('button', { name: '删除此行' })).toBeNull()
  })
})

describe('the tab title', () => {
  /**
   * A tab is called after the thing it holds, not after the kind of page.
   * Two data source tabs both reading "数据源" cannot be told apart, which is
   * the whole point of a tab having a title.
   */
  function openEditorTab(): void {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkspaceProvider>
          <OpenOnMount />
          <TabBar />
        </WorkspaceProvider>
      </QueryClientProvider>,
    )
  }

  function OpenOnMount(): null {
    const { open } = useWorkspace()
    useEffect(() => open({ kind: 'data-source', dataSourceId: 'ds-1' }), [])
    return null
  }

  it('names the table, prefixed by what kind of tab it is', async () => {
    // A bare table name in a strip that also holds designs does not say which
    // of the two it is, and they are edited very differently.
    openEditorTab()
    expect(await screen.findByText('数据源-订单表')).toBeDefined()
  })

  it('falls back to the generic name only until the list arrives', async () => {
    // A blank tab is worse than a generic one, so the fallback stays.
    sources = []
    openEditorTab()
    // Two of them: the sidebar entry and the tab. Both being generic is the
    // point — the tab has nothing better to show yet.
    expect((await screen.findAllByText('数据源')).length).toBeGreaterThan(0)
  })
})
