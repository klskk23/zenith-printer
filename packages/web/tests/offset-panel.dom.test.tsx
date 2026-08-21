/**
 * Setting the position correction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

/** Mutated by the stubbed PATCH, so a refetch returns what was saved. */
let stored = { offsetXDots: 0, offsetYDots: 0 }

const printer = () => ({
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
  createdAt: '2026-08-21T00:00:00.000Z', ...stored,
})

const sent: { offsetXDots: number; offsetYDots: number }[] = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)
beforeEach(() => {
  sent.length = 0
  stored = { offsetXDots: 0, offsetYDots: 0 }
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PATCH' && url.includes('/offset')) {
      const body = JSON.parse(String(init.body))
      sent.push(body)
      // Behave like the server: keep it, so a refetch returns it.
      stored = { offsetXDots: body.offsetXDots, offsetYDots: body.offsetYDots }
    }
    const body = url.includes('/profiles') ? { profiles: [] }
      : url.includes('/printers') ? { printers: [printer()] }
      : url.includes('/print-jobs') ? { jobs: [] } : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

async function openPrinters(): Promise<HTMLInputElement[]> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('打印机')[0]!)
  await screen.findAllByText('物理偏移校正')
  const panel = screen.getAllByText('物理偏移校正')[0]!.closest('div')!.parentElement!
  return [...panel.querySelectorAll('input')] as HTMLInputElement[]
}

describe('the offset fields', () => {
  it('renders four direction inputs', async () => {
    const inputs = await openPrinters()
    expect(inputs.length).toBeGreaterThanOrEqual(4)
  })

  it('accepts a typed value', async () => {
    const inputs = await openPrinters()
    fireEvent.change(inputs[2]!, { target: { value: '3' } })
    expect(Number(inputs[2]!.value)).toBe(3)
  })

  it('sends the correction when saved', async () => {
    const inputs = await openPrinters()
    fireEvent.change(inputs[2]!, { target: { value: '3' } })
    fireEvent.click(screen.getAllByText('保存偏移')[0]!)
    await waitFor(() => expect(sent.length).toBeGreaterThan(0))
  })
})

describe('after saving', () => {
  it('sends the direction as a signed offset', async () => {
    const inputs = await openPrinters()
    // Third box is "move down", which is a positive y.
    fireEvent.change(inputs[2]!, { target: { value: '3' } })
    fireEvent.click(screen.getAllByText('保存偏移')[0]!)
    await waitFor(() => expect(sent[0]).toEqual({ offsetXDots: 0, offsetYDots: 3 }))
  })

  it('keeps showing the saved value rather than resetting', async () => {
    const inputs = await openPrinters()
    fireEvent.change(inputs[2]!, { target: { value: '3' } })
    fireEvent.click(screen.getAllByText('保存偏移')[0]!)
    await waitFor(() => expect(sent.length).toBe(1))
    // The refetched printer carries the saved offset; the field must reflect it.
    await waitFor(() => expect(Number(inputs[2]!.value)).toBe(3))
  })

  it('maps "move up" to a negative y', async () => {
    const inputs = await openPrinters()
    fireEvent.change(inputs[0]!, { target: { value: '2' } })
    fireEvent.click(screen.getAllByText('保存偏移')[0]!)
    await waitFor(() => expect(sent[0]).toEqual({ offsetXDots: 0, offsetYDots: -2 }))
  })

  it('clears the opposing box', async () => {
    const inputs = await openPrinters()
    fireEvent.change(inputs[2]!, { target: { value: '3' } })
    fireEvent.change(inputs[0]!, { target: { value: '2' } })
    expect(Number(inputs[2]!.value)).toBe(0)
  })
})
