/**
 * Adding a printer.
 *
 * The form used to sit open below the list, which put five fields under the
 * printers on every visit — and the reason to come to this page is almost
 * always one of the printers already there. It is a dialog now, which is the
 * same shape the presets page uses.
 *
 * Worth a test of its own because the move happened with nothing watching it:
 * the whole add flow had no coverage, so the form could have been left
 * unreachable and every one of the two thousand tests would still have passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrintersPage } from '../src/features/printers/printers-page.tsx'

const posted: Array<Record<string, unknown>> = []
let printers: Array<Record<string, unknown>>

const PRINTER = {
  id: 'prn-1', name: '前台 B3S', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  printTaskName: 'B1', capabilities: null, queueState: 'running', queuePausedReason: null,
  lastProbedAt: null, createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve({
    ok: status < 400, status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  posted.length = 0
  printers = []
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/printers') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      printers = [PRINTER]
      return json(PRINTER, 201)
    }
    if (url.includes('/profiles')) return json({ profiles: [] })
    if (url.includes('/printers')) return json({ printers })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the add-printer dialog', () => {
  it('is behind a button, so the page opens on the printers', async () => {
    render(wrap(<PrintersPage />))
    expect(await screen.findByRole('button', { name: '添加打印机' })).toBeDefined()
    expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull()
  })

  it('is offered from the empty state too, where it is the only thing to do', async () => {
    // A page whose only content is "no printers yet" and whose only control is
    // in the header makes somebody look twice.
    render(wrap(<PrintersPage />))
    await screen.findByText('还没有添加打印机')
    expect(screen.getAllByRole('button', { name: '添加打印机' }).length).toBeGreaterThan(1)
  })

  it('adds the printer it was given', async () => {
    render(wrap(<PrintersPage />))
    fireEvent.click((await screen.findAllByRole('button', { name: '添加打印机' }))[0]!)
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '前台 B3S' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '添加打印机' }).pop()!)

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      name: '前台 B3S',
      kind: 'niimbot',
      transport: 'serial',
      address: '/dev/ttyACM0',
      printTaskName: 'B1',
    })
  })

  it('closes once the printer is there, rather than leaving the form up', async () => {
    render(wrap(<PrintersPage />))
    fireEvent.click((await screen.findAllByRole('button', { name: '添加打印机' }))[0]!)
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '前台 B3S' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '添加打印机' }).pop()!)

    await waitFor(() => expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull())
  })

  it('will not add one without a name', async () => {
    render(wrap(<PrintersPage />))
    fireEvent.click((await screen.findAllByRole('button', { name: '添加打印机' }))[0]!)
    await screen.findByRole('textbox', { name: '名称' })
    expect(screen.getAllByRole('button', { name: '添加打印机' }).pop()!.hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('moves the address default when the kind changes', async () => {
    // A ZPL printer on `/dev/ttyACM0` is a support call: the field carries the
    // default for whichever kind is chosen, not for whichever was first.
    render(wrap(<PrintersPage />))
    fireEvent.click((await screen.findAllByRole('button', { name: '添加打印机' }))[0]!)
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '类型' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: 'zpl' }))

    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: '地址' }) as HTMLInputElement).value).toBe(
        '192.168.1.50:9100',
      ),
    )
  })
})
