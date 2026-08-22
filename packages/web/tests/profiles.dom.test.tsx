/**
 * Managing print profiles.
 *
 * The panel was written as a controlled component when the editor hosted it.
 * The editor now picks a profile from a dropdown, leaving one caller that has
 * no interest in the selection — and it passed a no-op `onSelect`. Clicking a
 * profile therefore did nothing, the edit form never opened, and the only
 * delete button lives inside that form. Creating worked, because that path uses
 * local draft state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { openedOptions, selectedText } from './support/select.ts'

const CAPABILITIES = {
  dpi: 203,
  printheadPixels: 384,
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: [1],
  printDirection: 'top',
  supportsConsumableLevel: true,
  model: 'B3S_P',
  serial: null,
  firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1',
  name: 'B3S_P',
  kind: 'niimbot',
  transport: 'serial',
  address: '/dev/ttyACM0',
  capabilities: CAPABILITIES,
  queueState: 'running',
  queuePausedReason: null,
  lastProbedAt: '2026-08-21T00:00:00.000Z',
  createdAt: '2026-08-21T00:00:00.000Z',
  offsetXDots: 0,
  offsetYDots: 0,
}

const PROFILE = {
  id: 'prof-1',
  printerId: 'prn-1',
  name: '原厂 50×30',
  density: 3,
  labelType: 1,
  labelWidthMm: 50,
  labelHeightMm: 30,
  marginTopMm: 0,
  marginRightMm: 0,
  marginBottomMm: 0,
  marginLeftMm: 0,
  isDefault: true,
  createdAt: '2026-08-21T00:00:00.000Z',
}

const deleted: string[] = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  deleted.length = 0
  window.history.replaceState(null, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE' && url.includes('/profiles/')) {
        deleted.push(url.split('/profiles/')[1]!)
        return Promise.resolve({ ok: true, status: 204, headers: new Headers(), text: () => Promise.resolve('') } as unknown as Response)
      }
      const body = url.includes('/profiles')
        ? { profiles: [PROFILE] }
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
    }),
  )
})

/**
 * Open the printers page and the profile dialog for the first printer.
 *
 * Profiles used to sit unfolded under each printer. A page listing several
 * machines, each with its stock settings expanded beneath it, buries what the
 * page is for — which printers are there and whether they are running — so
 * they moved behind a button.
 */
async function openPrinters(): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('打印机')[0]!)
  fireEvent.click(await screen.findByText('打印参数'))
  await screen.findAllByText('原厂 50×30')
}

describe('the profile list', () => {
  it('shows the printer’s profiles', async () => {
    await openPrinters()
    expect(screen.getAllByText('原厂 50×30').length).toBeGreaterThan(0)
  })

  /** The bug: this click reached a no-op and nothing opened. */
  it('opens the edit form when a profile is clicked', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    expect(await screen.findAllByText('纸张宽度')).not.toHaveLength(0)
  })

  it('closes the form when the open profile is clicked again', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    await screen.findAllByText('纸张宽度')
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    expect(screen.queryByText('纸张宽度')).toBeNull()
  })

  it('exposes the margin fields', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    await screen.findAllByText('纸张宽度')
    expect(screen.getAllByText('边距').length).toBeGreaterThan(0)
  })
})

describe('deleting a profile', () => {
  it('reaches the delete button at all', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    await screen.findAllByText('纸张宽度')
    // Inside the form, which is why it was unreachable.
    expect(screen.getAllByText('删除').length).toBeGreaterThan(0)
  })

  it('confirms before deleting', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    await screen.findAllByText('纸张宽度')
    fireEvent.click(screen.getAllByText('删除')[0]!)

    expect(await screen.findAllByText('确认这项操作？')).not.toHaveLength(0)
    expect(deleted).toEqual([])
  })

  it('deletes once confirmed', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('原厂 50×30')[0]!)
    await screen.findAllByText('纸张宽度')
    // Scoped to the profile dialog. The printer card carries a delete button
    // of its own, and an unscoped search finds that one first — so this used to
    // open the confirmation for deleting the whole printer and then report
    // that no profile had been deleted.
    const panel = document.querySelector('[role="dialog"]')!
    const profileDelete = [...panel.querySelectorAll('button')].find((b) => b.textContent === '删除')!
    fireEvent.click(profileDelete)
    await screen.findAllByText('确认这项操作？')

    // The confirm button in the dialog, not the one that opened it.
    const dialog = document.querySelector('[role="alertdialog"]')!
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '删除')!
    fireEvent.click(confirm)

    // The mutation is asynchronous; asserting immediately would pass on a
    // component that merely closed the dialog.
    await waitFor(() => expect(deleted).toEqual(['prof-1']))
  })
})

describe('creating a profile', () => {
  it('opens a blank form', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('新建参数')[0]!)
    expect(await screen.findAllByText('纸张宽度')).not.toHaveLength(0)
  })
})

/**
 * The two settings that decide what survives binarisation.
 *
 * Both were reachable from the render pipeline and from nowhere a user could
 * get to — the cut-off through the preview endpoint alone, which meant a value
 * could be found for a pale logo and then had nowhere to go.
 */
describe('binarisation settings', () => {
  async function openForm(): Promise<void> {
    await openPrinters()
    fireEvent.click(screen.getAllByText('新建参数')[0]!)
    await screen.findAllByText('纸张宽度')
  }

  function fieldUnder(label: string): HTMLInputElement | HTMLSelectElement {
    const dialog = document.querySelector('[role="dialog"]')!
    const found = [...dialog.querySelectorAll('label')].find((l) => l.textContent === label)
    expect(found, `no field labelled ${label}`).toBeDefined()
    return found!.parentElement!.querySelector('input, select') as HTMLInputElement | HTMLSelectElement
  }

  it('offers the black/white cut-off', async () => {
    await openForm()
    expect((fieldUnder('黑白分界') as HTMLInputElement).value).toBe('128')
  })

  it('offers the image tone modes', async () => {
    await openForm()
    const select = screen.getByRole('combobox', { name: '图片色调' })
    expect(openedOptions(select)).toEqual(['不处理（硬阈值）', '误差扩散（照片）', '有序网点（耐热扩散）'])
  })

  it('keeps the cut-off inside the range the renderer accepts', async () => {
    await openForm()
    const field = fieldUnder('黑白分界') as HTMLInputElement
    fireEvent.change(field, { target: { value: '900' } })
    expect(Number(field.value)).toBeLessThanOrEqual(255)
    fireEvent.change(field, { target: { value: '0' } })
    expect(Number(field.value)).toBeGreaterThanOrEqual(1)
  })

  it('says what the cut-off costs, not just what it does', async () => {
    // Raising it rescues pale artwork and fattens every stroke on the label;
    // a control that mentions only the first invites people to raise it.
    await openForm()
    expect(screen.getByText(/笔画都会变粗/)).toBeDefined()
  })
})

/**
 * Choosing what paper the calibration page is for.
 *
 * It is measured against the edges of the label, so it has to be the size of
 * the label. The panel used to send no stock at all and the server guessed at
 * the printhead's full width — on a 50 mm roll that is a 104 mm page: a wasted
 * label with most of it missing.
 */
describe('calibration stock', () => {
  /**
   * The printers page itself, without opening the profiles dialog.
   *
   * The dialog marks everything behind it `aria-hidden`, so a control on the
   * page underneath stops being reachable by role — which is correct, and is
   * why these tests must not open it.
   */
  async function openPrintersPage(): Promise<void> {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    await screen.findAllByText('物理偏移校正')
  }

  it('offers the printer’s profiles', async () => {
    await openPrintersPage()
    const stock = screen.getByRole('combobox', { name: '校准用纸' })
    expect(openedOptions(stock).some((label) => label.includes('50×30mm'))).toBe(true)
  })

  it('shows the size that will be printed, before spending a label', async () => {
    await openPrinters()
    fireEvent.click(screen.getAllByText('打印校正页')[0]!)
    expect(await screen.findAllByText(/50×30mm/)).not.toHaveLength(0)
  })

  it('defaults to the default profile', async () => {
    await openPrintersPage()
    const stock = screen.getByRole('combobox', { name: '校准用纸' })
    expect(selectedText(stock)).toContain('50×30mm')
  })
})
