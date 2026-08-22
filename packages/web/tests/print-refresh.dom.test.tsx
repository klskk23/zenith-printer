/**
 * Refreshing from inside the print dialog.
 *
 * The trap this exists to prevent: a row selection is a set of ordinals, and a
 * refresh replaces the table. After that the numbers point at different rows,
 * so a selection kept across a refresh prints the wrong labels while looking
 * entirely correct — the count is right, the dialog is happy, and the wrong
 * customers get the wrong parcels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { labelIrSchema } from '@zenith/shared'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'

const CAPABILITIES = {
  dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}

const IR = labelIrSchema.parse({
  widthMm: 50, heightMm: 30, dpi: 203,
  elements: [{ id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }],
})

const LINKED = {
  id: 'ds-1', name: '本月出货', columns: ['订单号'], rowCount: 5,
  sourceKind: 'google-sheets', spreadsheetId: 'sheet-1', spreadsheetTitle: '出货台账',
  worksheetId: 0, worksheetTitle: '本月出货', lastRefreshedAt: 'T', createdAt: 'T', updatedAt: 'T',
}

let sourceKind = 'google-sheets'
let refreshes: number

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  refreshes = 0
  sourceKind = 'google-sheets'
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/refresh')) {
      refreshes += 1
      return json({ outcome: 'applied', rowsBefore: 5, rowsAfter: 9, columnsAdded: [], lastRefreshedAt: 'T2' })
    }
    if (url.includes('/api/preview')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      } as unknown as Response)
    }
    if (url.includes('/data-sources/ds-1/rows')) {
      return json({
        rows: Array.from({ length: 5 }, (_, i) => ({ ordinal: i + 1, values: { 订单号: `A-${i + 1}` } })),
        page: 1, pageSize: 10, total: 5,
      })
    }
    if (url.includes('/data-sources')) return json({ dataSources: [{ ...LINKED, sourceKind }] })
    return json({ warnings: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(): void {
  render(
    wrap(
      <PrintDialog
        ir={IR}
        templateId="tpl-1"
        profileId="pro-1"
        printer={PRINTER as never}
        variableValues={{}}
        unresolved={[]}
        dataSourceId="ds-1"
        onClose={() => undefined}
      />,
    ),
  )
}

describe('refreshing without leaving the print dialog', () => {
  it('offers the control for a linked table', async () => {
    open()
    expect(await screen.findByRole('button', { name: '刷新' })).toBeDefined()
  })

  it('does not offer it for a table maintained here', async () => {
    sourceKind = 'local'
    open()
    await screen.findByText(/共 5 行|全选/)
    expect(screen.queryByRole('button', { name: '刷新' })).toBeNull()
  })

  it('sits above the row selector, so a fetch happens before rows are picked', async () => {
    open()
    const control = await screen.findByRole('button', { name: '刷新' })
    const panel = document.querySelector('[data-row-selection]')
    expect(panel).not.toBeNull()

    const order = [...document.querySelectorAll('*')]
    expect(order.indexOf(control)).toBeLessThan(order.indexOf(panel!))
  })

  it('clears the row selection, not merely the message about it', async () => {
    open()
    const control = await screen.findByRole('button', { name: '刷新' })

    // Pick some rows first: the point is what happens to a selection that
    // already exists.
    fireEvent.click(await screen.findByText(/全选/))
    expect(await screen.findByText(/已选 5 行/)).toBeDefined()

    fireEvent.click(control)
    await waitFor(() => expect(refreshes).toBe(1))

    // The selection itself, not the notice. Asserting only the notice passes
    // even when the ordinals are still selected — which is precisely the bug:
    // the dialog would say the selection was cleared while printing the rows
    // those old numbers now point at.
    await waitFor(() => expect(screen.queryByText(/已选 5 行/)).toBeNull())
    expect(screen.getByText(/选择被清空/)).toBeDefined()
  })

  it('disables the control while a fetch is in flight', async () => {
    // Two writers on one table is how a half-replaced table happens. The
    // server refuses the second, but the button should not invite it.
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string, requestInit?: RequestInit) => {
      if (String(input).includes('/refresh')) {
        await held
      }
      return original(input as never, requestInit as never)
    }))

    open()
    const control = await screen.findByRole('button', { name: '刷新' })
    fireEvent.click(control)

    await waitFor(() =>
      expect((screen.getByRole('button', { name: '刷新' }) as HTMLButtonElement).disabled).toBe(true),
    )
    release?.()
  })

  it('does not fetch until it is asked to', async () => {
    open()
    await screen.findByRole('button', { name: '刷新' })
    expect(refreshes).toBe(0)
  })
})
