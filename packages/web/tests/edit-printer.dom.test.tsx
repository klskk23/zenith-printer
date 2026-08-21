/**
 * Correcting a printer's connection, and keeping profiles out of the way.
 *
 * An address is not permanent — a networked printer is given a new IP, a USB
 * node is renumbered, a serial port moves — and before this the only way to fix
 * one was to delete the printer and add it again, discarding its profiles, its
 * position correction and the link from every job it had ever run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const patches: Array<{ url: string; body: Record<string, unknown> }> = []

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  printTaskName: 'B1', capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: '2026-08-21T00:00:00.000Z', createdAt: '2026-08-21T00:00:00.000Z',
  offsetXDots: 0, offsetYDots: 0,
}

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  patches.length = 0
  window.history.replaceState(null, '', '/printers')
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PATCH') {
      patches.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    }
    const body = url.includes('/profiles')
      ? { profiles: [] }
      : url.includes('/printers')
        ? { printers: [PRINTER] }
        : {}
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

/** The field under a given label, inside the open dialog. */
function dialogField(label: string): HTMLInputElement {
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog, 'no dialog is open').not.toBeNull()
  const found = [...dialog!.querySelectorAll('label')].find((l) => l.textContent === label)
  expect(found, `no field labelled ${label}`).toBeDefined()
  return found!.parentElement!.querySelector('input') as HTMLInputElement
}

async function openEditDialog(): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('打印机')[0]!)
  fireEvent.click(await screen.findByText('编辑连接'))
}

describe('the printers page', () => {
  /**
   * A page listing several machines, each with its stock settings unfolded
   * beneath it, buries what the page is for: which printers are there, and
   * whether they are running.
   */
  it('keeps profiles behind a button rather than expanded', async () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    await screen.findByText('打印参数')

    // The profile form's fields are not on the page until asked for.
    expect(screen.queryByText('纸张宽度')).toBeNull()

    fireEvent.click(screen.getByText('打印参数'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('says what its delete button deletes', async () => {
    // The profile list has a "delete" of its own; two buttons reading the same
    // word on one screen, meaning different things, is a trap.
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    expect(await screen.findByText('删除打印机')).toBeDefined()
  })
})

describe('editing a printer’s connection', () => {
  it('offers the address for editing', async () => {
    await openEditDialog()
    expect(dialogField('地址').value).toBe('/dev/ttyACM0')
  })

  it('saves the new address', async () => {
    await openEditDialog()
    fireEvent.change(dialogField('地址'), { target: { value: '/dev/ttyACM1' } })
    fireEvent.click(screen.getByText('保存'))

    await vi.waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.url).toContain('/printers/prn-1')
    expect(patches[0]!.body).toMatchObject({ address: '/dev/ttyACM1' })
  })

  it('saves a new name too', async () => {
    await openEditDialog()
    fireEvent.change(dialogField('名称'), { target: { value: '前台标签机' } })
    fireEvent.click(screen.getByText('保存'))

    await vi.waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.body).toMatchObject({ name: '前台标签机' })
  })

  /**
   * The probed numbers describe whatever answered at the old address — head
   * width, dpi, density range — and printing against another machine's figures
   * goes wrong in ways nobody checks. Said before saving, not after.
   */
  it('warns that moving the address discards the probed settings', async () => {
    await openEditDialog()
    expect(screen.queryByText(/重新探测/)).toBeNull()

    fireEvent.change(dialogField('地址'), { target: { value: '/dev/ttyACM1' } })
    expect(screen.getByText(/重新探测/)).toBeDefined()
  })

  it('does not warn when only the name changed', async () => {
    await openEditDialog()
    fireEvent.change(dialogField('名称'), { target: { value: '前台标签机' } })
    expect(screen.queryByText(/重新探测/)).toBeNull()
  })

  it('offers the print task for a NIIMBOT', async () => {
    await openEditDialog()
    expect(dialogField('打印任务').value).toBe('B1')
  })

  it('sends nothing when cancelled', async () => {
    await openEditDialog()
    fireEvent.change(dialogField('地址'), { target: { value: '/dev/ttyACM1' } })
    fireEvent.click(screen.getByText('取消'))

    await new Promise((r) => setTimeout(r, 50))
    expect(patches).toHaveLength(0)
  })

  it('reopens with the stored address, not the abandoned edit', async () => {
    await openEditDialog()
    fireEvent.change(dialogField('地址'), { target: { value: '/dev/ttyACM9' } })
    fireEvent.click(screen.getByText('取消'))

    fireEvent.click(screen.getByText('编辑连接'))
    expect(dialogField('地址').value).toBe('/dev/ttyACM0')
  })
})
