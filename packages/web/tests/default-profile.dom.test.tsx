/**
 * The default profile drives the defaults.
 *
 * "Default profile" was a concept the system referred to in three places — the
 * editor's selector, the calibration page's stock, the server's fallback — and
 * the form had no control for setting it, so the flag was always false and each
 * of those fell back to "the first one" or "none".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: {
    dpi: 203, printheadPixels: 832, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B3S_P', serial: null, firmwareVersion: null,
  },
  queueState: 'running', queuePausedReason: null, lastProbedAt: '2026-08-21T00:00:00.000Z',
  createdAt: '2026-08-21T00:00:00.000Z', offsetXDots: 0, offsetYDots: 0,
}

const margins = { marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0 }

const PROFILES = [
  { id: 'p-narrow', printerId: 'prn-1', name: '第三方 40×20', density: 3, labelType: 1,
    labelWidthMm: 40, labelHeightMm: 20, ...margins, isDefault: false,
    createdAt: '2026-08-21T00:00:00.000Z' },
  { id: 'p-stock', printerId: 'prn-1', name: '原厂 50×30', density: 3, labelType: 1,
    labelWidthMm: 50, labelHeightMm: 30, ...margins, isDefault: true,
    createdAt: '2026-08-21T00:00:00.000Z' },
]

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    const body = url.includes('/profiles') ? { profiles: PROFILES }
      : url.includes('/printers') ? { printers: [PRINTER] }
      : url.includes('/templates') ? { templates: [] }
      : url.includes('/print-jobs') ? { jobs: [] }
      : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

async function openDesign(): Promise<HTMLElement> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('标签设计')[0]!)
  return screen.getByRole('toolbar', { name: '标签设计' })
}

/**
 * Select a printer, once there is one to select.
 *
 * Firing the change before the query resolves does nothing at all: a controlled
 * `<select>` ignores a value with no matching option, and silently — which is
 * why the first version of this test reported an empty selector rather than a
 * missing one.
 */
async function chooseFirstPrinter(toolbar: HTMLElement): Promise<void> {
  const printer = selectByLabel(toolbar, '打印机')
  await vi.waitFor(() => expect(printer.options.length).toBeGreaterThan(1))
  fireEvent.change(printer, { target: { value: 'prn-1' } })
  await vi.waitFor(() => expect(printer.value).toBe('prn-1'))
}

/** The canvas width field in the left column. */
function canvasWidth(): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent === '宽度')
  expect(label, 'no canvas width field').toBeDefined()
  return label!.parentElement!.querySelector('input') as HTMLInputElement
}

/** The select that sits directly under a given label. */
function selectByLabel(toolbar: HTMLElement, label: string): HTMLSelectElement {
  const el = [...toolbar.querySelectorAll('label')].find((l) => l.textContent === label)
  expect(el, `no field labelled ${label}`).toBeDefined()
  const select = el!.parentElement!.querySelector('select')
  expect(select, `no select under ${label}`).not.toBeNull()
  return select as HTMLSelectElement
}

describe('choosing a printer in the editor', () => {
  it('preselects that printer’s default profile', async () => {
    const toolbar = await openDesign()
    await chooseFirstPrinter(toolbar)

    const profile = selectByLabel(toolbar, '打印参数')
    // Not the first in the list — the one marked default.
    await vi.waitFor(() => expect(profile.value).toBe('p-stock'))
  })

  /**
   * The canvas follows the stock, so preselecting has to bring the size with
   * it — otherwise the design is laid out against nothing in particular.
   *
   * Asserted by switching to the *other* profile: a blank label already starts
   * at 50x30, so checking for 50 after selecting the 50x30 default would pass
   * without the linkage existing at all.
   */
  it('sizes the canvas to the chosen profile’s stock', async () => {
    const toolbar = await openDesign()
    await chooseFirstPrinter(toolbar)

    const profile = selectByLabel(toolbar, '打印参数')
    await vi.waitFor(() => expect(profile.value).toBe('p-stock'))

    fireEvent.change(profile, { target: { value: 'p-narrow' } })

    await vi.waitFor(() => expect(Number(canvasWidth().value)).toBe(40))
  })

  it('does not override a profile the user chose', async () => {
    const toolbar = await openDesign()
    await chooseFirstPrinter(toolbar)

    const profile = selectByLabel(toolbar, '打印参数')
    await vi.waitFor(() => expect(profile.value).toBe('p-stock'))

    fireEvent.change(profile, { target: { value: 'p-narrow' } })
    // Refetching must not reselect the default over a deliberate choice.
    await vi.waitFor(() => expect(profile.value).toBe('p-narrow'))
  })
})

describe('the calibration page', () => {
  it('uses the default profile, not the first in the list', async () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    await screen.findAllByText('物理偏移校正')

    const stock = [...document.querySelectorAll('select')]
      .find((el) => el.textContent?.includes('50×30mm')) as HTMLSelectElement
    expect(stock.value).toBe('p-stock')
  })
})

describe('the profile form', () => {
  /**
   * Profiles live behind a button on the printers page rather than unfolded
   * under each printer, so the form is two clicks in: open the dialog, then
   * pick the profile.
   */
  async function openProfileForm(): Promise<void> {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    fireEvent.click(await screen.findByText('打印参数'))
    fireEvent.click((await screen.findAllByText('原厂 50×30'))[0]!)
  }

  it('offers a control for making a profile the default', async () => {
    await openProfileForm()
    // Without this the flag could never be set, so the default was a concept
    // the system referred to and nobody could create.
    expect(await screen.findAllByText('设为默认')).not.toHaveLength(0)
  })

  it('explains what being the default does', async () => {
    await openProfileForm()
    expect(await screen.findAllByText(/自动选中/)).not.toHaveLength(0)
  })
})
