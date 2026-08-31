/**
 * Which row the canvas is drawn against while a design is being written.
 *
 * `${列名}` has no value in the editor — there is no batch yet — so the canvas
 * substituted the bound table's **first row** and there was no way to see any
 * other. That is the row least likely to be the interesting one: the layout
 * question is whether the longest name still fits, or what the design does with
 * the empty cell on row 87.
 *
 * The choice is deliberately temporary. It changes what is drawn and nothing
 * else: it is not part of the design, so it is not saved, and reopening or
 * rebinding starts again at row one — which is exactly the behaviour that was
 * there before, kept as the default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { chooseOption, selectTrigger } from './support/select.ts'

const CAPABILITIES = {
  // 576 px at 203 dpi is a 72 mm head. At 384 the default 50 mm design is
  // wider than the printer and the print button stays disabled — correctly.
  dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
  labelWidthMm: 50, labelHeightMm: 30,
}

const SOURCE = {
  id: 'ds-1',
  name: '库存表',
  columns: ['sku', '名称'],
  rowCount: 3,
  sourceKind: 'local',
  createdAt: 'T',
  updatedAt: 'T',
}

const ROWS = [
  { ordinal: 1, values: { sku: 'AAA-1', 名称: '垫片' } },
  { ordinal: 2, values: { sku: 'BBB-2', 名称: '螺栓' } },
  { ordinal: 3, values: { sku: 'CCC-3', 名称: '一个名字很长的零件' } },
]

/** Every row page the editor asked for, so "which row" is checkable. */
const rowRequests: Array<{ page: number; pageSize: number }> = []
/** Preview bodies the print dialog sent, so the boundary between the two is checkable. */
const previews: Array<Record<string, unknown>> = []
let saved: Array<Record<string, unknown>> = []
let sources: Array<Record<string, unknown>> = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  rowRequests.length = 0
  previews.length = 0
  saved = []
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:p', revokeObjectURL: () => undefined })
  sources = [SOURCE]
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    let body: unknown = {}

    if (url.includes('/api/preview')) {
      previews.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      } as unknown as Response)
    }

    const rows = /\/data-sources\/([^/]+)\/rows\?(.*)$/.exec(url)
    if (rows !== null) {
      const query = new URLSearchParams(rows[2])
      const page = Number(query.get('page'))
      const pageSize = Number(query.get('pageSize'))
      rowRequests.push({ page, pageSize })
      // Paged the way the server pages: page N at size 1 is row N.
      const from = (page - 1) * pageSize
      body = { rows: ROWS.slice(from, from + pageSize), page, pageSize, total: ROWS.length }
    } else if (url.includes('/data-sources')) {
      body = { dataSources: sources }
    } else if (url.includes('/templates') && init?.method === 'POST') {
      saved.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      body = { id: 'tpl-1' }
    } else if (url.includes('/templates')) {
      body = { templates: [] }
    } else if (url.includes('/printers')) {
      body = { printers: [PRINTER] }
    } else if (url.includes('/profiles')) {
      body = { profiles: [] }
    } else if (url.includes('/sequence-pools')) {
      body = { pools: [] }
    } else if (url.includes('/print-jobs')) {
      body = { jobs: [], total: 0 }
    }

    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

function openDesign(): void {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('标签设计')[0]!)
}

/**
 * The inspector's second tab, where the binding and the variables live.
 *
 * Focus, not click: Radix activates a tab on focus, and in happy-dom a click
 * alone leaves the panel unmounted. Same idiom as editor-elements.dom.test.tsx.
 */
function openVariablesTab(): void {
  fireEvent.focus(screen.getByRole('tab', { name: '变量' }))
}

/** Bind the table and put a reference to one of its columns on the label. */
async function bindAndReference(): Promise<void> {
  fireEvent.click(screen.getByText('文字'))
  const content = await screen.findByLabelText('内容')
  fireEvent.change(content, { target: { value: '${名称}' } })
  openVariablesTab()
  chooseOption(selectTrigger('数据源'), '库存表')
}

/**
 * What the canvas is actually drawing.
 *
 * Selected by its own container: the page is full of lucide icons, and
 * `querySelector('svg')` finds one of those, whose textContent is always ''.
 */
const canvasText = (): string =>
  document.querySelector('[data-label-canvas] svg')?.textContent ?? ''

const rowInput = (): HTMLInputElement => screen.getByLabelText('取第几行') as HTMLInputElement

/** Choose the printer — the print button stays disabled until one is — and open the dialog. */
async function openPrintDialog(): Promise<void> {
  // The option reads "name · 50×30mm", so matched loosely.
  chooseOption(selectTrigger('打印机'), /B3S_P/)
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: '打印' })).not.toHaveProperty('disabled', true),
  )
  fireEvent.click(screen.getByRole('button', { name: '打印' }))
}

describe('the row the canvas uses', () => {
  it('is the first one, as it always was', async () => {
    openDesign()
    await bindAndReference()
    await vi.waitFor(() => expect(canvasText()).toContain('垫片'))
  })

  it('can be any other row', async () => {
    openDesign()
    await bindAndReference()
    await vi.waitFor(() => expect(canvasText()).toContain('垫片'))

    fireEvent.change(rowInput(), { target: { value: '3' } })

    // The long name is the reason to look at another row at all.
    await vi.waitFor(() => expect(canvasText()).toContain('一个名字很长的零件'))
    expect(canvasText()).not.toContain('垫片')
  })

  it('fetches that row rather than filtering a page it already has', async () => {
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '2' } })
    await vi.waitFor(() => expect(canvasText()).toContain('螺栓'))
    expect(rowRequests).toContainEqual({ page: 2, pageSize: 1 })
  })

  it('shows the values it is standing in for', async () => {
    // The panel is called 临时值; without the values on screen it would be a
    // number field with no way to tell what it selected.
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '2' } })
    const panel = document.querySelector('[data-variables-panel]')!
    await vi.waitFor(() => expect(panel.textContent).toContain('BBB-2'))
  })
})

describe('the bounds of it', () => {
  it('refuses to go below the first row', async () => {
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '0' } })
    await vi.waitFor(() => expect(canvasText()).toContain('垫片'))
    expect(rowRequests.some((request) => request.page < 1)).toBe(false)
  })

  it('refuses to go past the last', async () => {
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '9' } })
    await vi.waitFor(() => expect(canvasText()).toContain('一个名字很长的零件'))
    expect(rowRequests.some((request) => request.page > ROWS.length)).toBe(false)
  })

  it('is not offered at all when no table is bound', () => {
    openDesign()
    openVariablesTab()
    expect(screen.queryByLabelText('取第几行')).toBeNull()
  })
})

describe('what it is not', () => {
  it('is absent from the saved design', async () => {
    // Temporary means temporary: a preview row stored in the template would
    // be a second, invisible piece of state deciding what a design means.
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '3' } })
    await vi.waitFor(() => expect(canvasText()).toContain('一个名字很长的零件'))

    fireEvent.click(screen.getByText('保存为模板'))
    // By role inside the dialog: that Label carries no `for`, so the field is
    // not reachable by its text. Worth fixing, but not from here.
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '面单' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(JSON.stringify(saved[0])).not.toContain('previewRow')
    // And the reference itself is stored, not the value it was showing.
    expect(JSON.stringify(saved[0])).toContain('${名称}')
    expect(JSON.stringify(saved[0])).not.toContain('一个名字很长的零件')
  })
})

describe('the boundary with printing', () => {
  /**
   * The canvas row must not follow the design into the print dialog.
   *
   * It is a convenience for looking at a layout. Sent as variable values it
   * would pin every label in the batch to whichever row happened to be on
   * screen when the dialog was opened — and it would do it silently, since a
   * grid of identical labels captioned as different rows looks like a working
   * feature.
   */
  it('does not send the canvas row as the batch\'s values', async () => {
    openDesign()
    await bindAndReference()
    fireEvent.change(rowInput(), { target: { value: '3' } })
    await vi.waitFor(() => expect(canvasText()).toContain('一个名字很长的零件'))

    await openPrintDialog()

    await vi.waitFor(() => expect(previews.length).toBeGreaterThan(0))
    const values = (previews[0]?.variableValues ?? {}) as Record<string, string>
    expect(Object.keys(values)).not.toContain('名称')
    expect(JSON.stringify(previews[0])).not.toContain('一个名字很长的零件')
  })

  it('names the table instead, so the server resolves the row itself', async () => {
    openDesign()
    await bindAndReference()
    // Until the row lands the reference is unresolved, and an unresolved
    // reference is exactly what stops a preview being asked for at all.
    await vi.waitFor(() => expect(canvasText()).toContain('垫片'))
    await openPrintDialog()

    await vi.waitFor(() => expect(previews.length).toBeGreaterThan(0))
    expect(previews[0]).toMatchObject({ dataSourceId: 'ds-1' })
  })
})
