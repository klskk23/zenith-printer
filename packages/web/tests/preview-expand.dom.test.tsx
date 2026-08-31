/**
 * Seeing more than the first label before committing the stock.
 *
 * The preview has always shown one label: the first row of the batch in print
 * order. That is the right default — it is a label that will genuinely come out,
 * where a composite of all of them is a label nobody receives — and it is kept.
 * What it could not answer is the question people actually open the dialog
 * with: *do the other two hundred look right too?* A barcode's width follows its
 * content, so row 87 can overflow while row 1 is perfect.
 *
 * Expanded, it draws every selected row through the same server pipeline, ten
 * at a time. Ten because each one is a real render: the whole selection at once
 * would be up to a thousand requests to answer a question about the first
 * screenful.
 *
 * With nothing selected there is nothing to expand, and the single preview
 * stays exactly as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'
import { labelIrSchema } from '@zenith/shared'

const TOTAL = 24

const SOURCE = {
  id: 'ds-1', name: '订单表', columns: ['订单号'], rowCount: TOTAL,
  sourceKind: 'local', createdAt: 'T', updatedAt: 'T',
}

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}

const IR = labelIrSchema.parse({
  widthMm: 40, heightMm: 30, dpi: 203,
  elements: [{ id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }],
})

/** Every preview the dialog asked the server to render, in request order. */
const previews: Array<Record<string, unknown>> = []

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  previews.length = 0
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined })
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown) =>
      Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)

    if (url.includes('/api/preview')) {
      previews.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      } as unknown as Response)
    }
    if (url.includes('/rows')) {
      const page = Number(/page=(\d+)/.exec(url)?.[1] ?? 1)
      const pageSize = Number(/pageSize=(\d+)/.exec(url)?.[1] ?? 10)
      const rows = Array.from({ length: pageSize }, (_unused, i) => {
        const ordinal = (page - 1) * pageSize + i + 1
        return { ordinal, values: { 订单号: `A-${ordinal}` } }
      }).filter((row) => row.ordinal <= TOTAL)
      return json({ rows, page, pageSize, total: TOTAL })
    }
    if (url.includes('/data-sources')) return json({ dataSources: [SOURCE] })
    if (url.includes('/preflight')) return json({ warnings: [] })
    return json({})
  }))
})

function open(): void {
  render(
    wrap(
      <PrintDialog
        ir={IR}
        templateId={null}
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

const selectAll = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: `全选（${TOTAL} 行）` }))
}

/** Rows the server was asked to draw, in the order it was asked. */
const drawnOrdinals = (): number[] =>
  previews.map((body) => Number(body.rowOrdinal)).filter((ordinal) => Number.isFinite(ordinal))

const expandButton = () => screen.queryByRole('button', { name: /展开/ })

describe('what every preview carries', () => {
  it('names the table, without which the row number means nothing', async () => {
    // The server resolves the row itself. Before it was told which table, it
    // accepted `rowOrdinal` and ignored it, and every row came back identical.
    open()
    await selectAll()
    await vi.waitFor(() => expect(previews.length).toBeGreaterThan(0))
    expect(previews.every((body) => body.dataSourceId === 'ds-1')).toBe(true)
  })
})

describe('collapsed, which is the default', () => {
  it('draws the first selected row and only that', async () => {
    open()
    await selectAll()
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(1))
    expect(new Set(drawnOrdinals())).toEqual(new Set([1]))
  })

  it('takes the first in table order, not the first ticked', async () => {
    // Printing is by ascending ordinal regardless of tick order, so the label
    // that actually comes out first is row 3.
    open()
    fireEvent.click(await screen.findByLabelText('行号 5'))
    fireEvent.click(screen.getByLabelText('行号 3'))
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(3))
    expect(drawnOrdinals().at(-1)).toBe(3)
  })
})

describe('what may be expanded', () => {
  it('nothing, while nothing is selected', async () => {
    open()
    await screen.findByRole('button', { name: `全选（${TOTAL} 行）` })
    expect(expandButton()).toBeNull()
  })

  it('nothing, when the selection is a single row', async () => {
    // Expanding one row would show the label already on screen.
    open()
    fireEvent.click(await screen.findByLabelText('行号 3'))
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(3))
    expect(expandButton()).toBeNull()
  })

  it('the rest of them, once more than one is selected', async () => {
    open()
    await selectAll()
    expect(await screen.findByRole('button', { name: /展开/ })).toBeDefined()
  })
})

describe('expanded', () => {
  const expand = async (): Promise<void> => {
    await selectAll()
    fireEvent.click(await screen.findByRole('button', { name: /展开/ }))
  }

  it('draws the first ten selected rows', async () => {
    open()
    await expand()
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(10))
    expect([...new Set(drawnOrdinals())].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('says which row each one is', async () => {
    open()
    await expand()
    expect(await screen.findByText('第 7 行')).toBeDefined()
  })

  it('goes on to the next ten', async () => {
    open()
    await expand()
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(10))
    previews.length = 0

    fireEvent.click(screen.getByRole('button', { name: '下一页效果图' }))

    await vi.waitFor(() => expect(drawnOrdinals()).toContain(20))
    expect([...new Set(drawnOrdinals())].sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })

  it('ends with the remainder, not a full last page', async () => {
    open()
    await expand()
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(10))
    fireEvent.click(screen.getByRole('button', { name: '下一页效果图' }))
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(20))
    previews.length = 0

    fireEvent.click(screen.getByRole('button', { name: '下一页效果图' }))

    await vi.waitFor(() => expect(drawnOrdinals()).toContain(24))
    expect([...new Set(drawnOrdinals())].sort((a, b) => a - b)).toEqual([21, 22, 23, 24])
  })

  it('draws only the rows that were chosen', async () => {
    open()
    fireEvent.click(await screen.findByLabelText('行号 2'))
    fireEvent.click(screen.getByLabelText('行号 9'))
    fireEvent.click(await screen.findByRole('button', { name: /展开/ }))

    await vi.waitFor(() => expect(drawnOrdinals()).toContain(9))
    expect([...new Set(drawnOrdinals())].sort((a, b) => a - b)).toEqual([2, 9])
  })

  it('collapses back to the one label', async () => {
    open()
    await expand()
    await vi.waitFor(() => expect(drawnOrdinals()).toContain(10))
    previews.length = 0

    fireEvent.click(screen.getByRole('button', { name: '收起' }))

    await vi.waitFor(() => expect(drawnOrdinals()).toContain(1))
    expect(new Set(drawnOrdinals())).toEqual(new Set([1]))
  })
})
