/**
 * The application has to work on a plain LAN address.
 *
 * `http://192.168.x.x:3000` is not a secure context, and a browser withholds
 * part of the Web Crypto API there: `crypto.randomUUID()` and `crypto.subtle`
 * simply are not defined. `crypto.getRandomValues()` is not gated that way.
 *
 * This is not hypothetical. The print dialog minted its idempotency key with
 * `crypto.randomUUID()` inside a `useMemo`, so on every machine except the
 * server's own the dialog threw before it rendered anything — three browsers
 * open, two of them dead, and the one that worked was the one on localhost.
 * Every test passed throughout, because happy-dom defines the whole API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'
import { labelIrSchema } from '@zenith/shared'

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: '2026-08-22T00:00:00.000Z', createdAt: '2026-08-22T00:00:00.000Z',
  offsetXDots: 0, offsetYDots: 0,
}

const IR = labelIrSchema.parse({
  widthMm: 50, heightMm: 30, dpi: 203,
  elements: [{ id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }],
})

/** The Idempotency-Key of every submitted job, in order. */
const submitted: Array<string | null> = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  submitted.length = 0
  // Exactly what a browser hands a page served over plain HTTP from a LAN
  // address: getRandomValues present, randomUUID and subtle absent.
  const real = globalThis.crypto
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
  })

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:preview',
    revokeObjectURL: () => undefined,
  })
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/print-jobs') && init?.method === 'POST') {
      submitted.push(new Headers(init.headers).get('Idempotency-Key'))
      return Promise.resolve({
        ok: true, status: 202,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ jobId: 'job-1', status: 'queued' }),
      } as unknown as Response)
    }
    if (url.includes('/api/preview')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      } as unknown as Response)
    }
    const body = { warnings: [] }
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

describe('a page served over plain HTTP', () => {
  it('has no crypto.randomUUID, which is the situation being tested', () => {
    // Guards the guard: if happy-dom or a future stub quietly restored the
    // function, the test below would pass without testing anything.
    expect((globalThis.crypto as Partial<Crypto>).randomUUID).toBeUndefined()
  })

  it('still opens the print dialog', () => {
    open()
    expect(screen.getByRole('heading', { name: '确认打印' })).toBeDefined()
  })

  it('still sends an idempotency key with the job', async () => {
    // Rendering is only half of it. The key exists so that a double click or a
    // replayed request returns the same job instead of a second stack of
    // labels; a fix that rendered but sent nothing would have quietly removed
    // that protection on every machine except the server's own.
    open()
    fireEvent.click(screen.getByRole('button', { name: '确认打印' }))
    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
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
        dataSourceId={null}
        onClose={() => undefined}
      />,
    ),
  )
}
