/**
 * Opening a design from `/design/{templateId}?preset={presetId}`.
 *
 * The asset ledger links every label this way, meaning "take me there with the
 * settings already set". Before this the link opened the right design and
 * nothing else: printer, print settings and copies all sat at their defaults,
 * which looks exactly like having worked. Somebody finds out otherwise by
 * holding the labels.
 *
 * Driven through the real `App`, address bar included, because every piece of
 * this — the query surviving the route parser, surviving the writeback,
 * reaching the editor's state — already existed in isolation and connected to
 * nothing.
 *
 * What it deliberately does **not** do is print. The link says "put the
 * settings in place"; paper is somebody's decision, made in front of the
 * machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const TEMPLATE = {
  id: 'tpl-7',
  name: '路由器标签',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    {
      id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
      content: 'MAC', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
    },
  ],
  variables: [],
  dataSourceId: null,
  createdAt: 'T',
  updatedAt: 'T',
  version: 1,
  bindingIssue: null,
}

const PRINTERS = [
  {
    id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/a',
    capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
    createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
  },
  {
    id: 'prn-2', name: '仓库机', kind: 'niimbot', transport: 'serial', address: '/dev/b',
    capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
    createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
  },
]

const profile = (id: string, name: string, isDefault: boolean, w = 50, h = 30) => ({
  id, printerId: 'prn-2', name, density: 4, labelType: 1,
  labelWidthMm: w, labelHeightMm: h,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
  isDefault, halftone: 'none', threshold: 128, createdAt: 'T',
})

const PROFILES = [profile('prf-default', '默认卷', true), profile('prf-small', '小卷', false, 40, 20)]

const PRESET = {
  id: 'pre-1',
  name: '路由器标签',
  templateId: 'tpl-7',
  printerId: 'prn-2',
  profileId: 'prf-small',
  copies: 3,
  createdAt: 'T',
  updatedAt: 'T',
}

let presets: Array<Record<string, unknown>>
let printers: Array<Record<string, unknown>>
let profiles: Array<Record<string, unknown>>

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  presets = [PRESET]
  printers = PRINTERS
  profiles = PROFILES
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    const body = url.includes('/print-presets')
      ? { presets }
      : url.includes('/profiles')
        ? { profiles }
        : url.includes('/printers')
          ? { printers }
          : url.includes('/templates/')
            ? TEMPLATE
            : url.includes('/templates')
              ? { templates: [TEMPLATE] }
              : url.includes('/print-jobs')
                ? { jobs: [], total: 0 }
                : url.includes('/data-sources')
                  ? { dataSources: [] }
                  : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

/** Land on an address the way a followed link does. */
function land(address: string): void {
  window.history.replaceState(null, '', address)
  render(wrap(<App />))
}

const selectValue = (label: string): string =>
  screen.getByRole('combobox', { name: label }).textContent ?? ''

describe('a link carrying a preset', () => {
  it('opens the design the address names', async () => {
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByRole('toolbar', { name: '标签设计' })).toBeDefined()
  })

  it('selects the printer the preset records, not the default', async () => {
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
  })

  it('selects the print settings the preset records', async () => {
    // Not the printer's default profile, which the editor would otherwise
    // preselect the moment a printer is chosen.
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印参数')).toContain('小卷'))
  })

  it('takes the canvas to that stock, the same as choosing it by hand would', async () => {
    // A design laid out on a canvas that is not the paper prints wrong, and
    // nobody notices until it does.
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() =>
      expect((screen.getByLabelText('宽度') as HTMLInputElement).value).toBe('40'),
    )
    expect((screen.getByLabelText('高度') as HTMLInputElement).value).toBe('20')
  })

  it('says what it did, since it changed things nobody watched it change', async () => {
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByText(/已按预设/)).toBeDefined()
  })

  it('prints nothing, and does not open the dialog', async () => {
    // The link means "take me there with the settings ready". Paper is a
    // decision made in front of the machine.
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
    expect(screen.queryByText('确认打印')).toBeNull()
    const posted = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(posted).toHaveLength(0)
  })

  it('keeps the preset in the address, so a refresh lands in the same place', async () => {
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
    // The address is rewritten from the active tab on every switch; a preset
    // the tab did not keep would vanish on the first one.
    expect(window.location.pathname + window.location.search).toBe('/design/tpl-7?preset=pre-1')
  })

  it('carries the copy count into the print dialog', async () => {
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
    // The toolbar's own print button, not the sidebar entries that share the
    // word.
    const toolbar = screen.getByRole('toolbar', { name: '标签设计' })
    fireEvent.click(
      [...toolbar.querySelectorAll('button')].find((b) => b.textContent?.trim() === '打印')!,
    )
    const copies = await screen.findByRole('spinbutton', { name: '份数' })
    expect((copies as HTMLInputElement).value).toBe('3')
  })
})

describe('the back button', () => {
  it('returns to the design with its preset still in the address', async () => {
    // The address is rewritten from the active tab. A tab that dropped the
    // preset would come back to a design whose settings had quietly gone to
    // default, with the link that set them nowhere in sight.
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))

    fireEvent.click(screen.getAllByText('首页')[0]!)
    await waitFor(() => expect(window.location.pathname).toBe('/'))

    window.history.replaceState(null, '', '/design/tpl-7?preset=pre-1')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe('/design/tpl-7?preset=pre-1'),
    )
    expect(selectValue('打印机')).toContain('仓库机')
  })
})

describe('once somebody has taken over', () => {
  it('does not put the printer back when the lists refetch', async () => {
    /**
     * The preset is an initial value; reapplying it would make the selector
     * fight whoever is standing at the machine.
     *
     * The refetch is the part that matters and the part that is easy to test
     * vacuously: simply choosing another printer does not re-run the effect,
     * so a test that stopped there would pass with the guard deleted. This one
     * changes what the server answers and brings the window back into focus,
     * which is what actually happens while somebody has the tab open.
     */
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))

    fireEvent.pointerDown(screen.getByRole('combobox', { name: '打印机' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: /前台机/ }))
    await waitFor(() => expect(selectValue('打印机')).toContain('前台机'))

    // Somebody edited a preset in another tab; every list comes back changed.
    presets = [{ ...PRESET, name: '改过的名字' }, { ...PRESET, id: 'pre-2', name: '另一个' }]
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
          String(url).includes('/print-presets'),
        ).length,
      ).toBeGreaterThan(1),
    )

    expect(selectValue('打印机')).toContain('前台机')
  })
})

describe('when the preset cannot do what the link promised', () => {
  it('says so when there is no such preset, and still opens the design', async () => {
    presets = []
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByText(/预设不存在/)).toBeDefined()
    expect(screen.getByRole('toolbar', { name: '标签设计' })).toBeDefined()
  })

  it('does not fall back to a printer nobody chose', async () => {
    // Silently printing to whichever printer is first in the list is the one
    // outcome worth refusing: it produces labels on the wrong machine.
    presets = []
    land('/design/tpl-7?preset=pre-1')
    await screen.findByText(/预设不存在/)
    expect(selectValue('打印机')).not.toContain('前台机')
    expect(selectValue('打印机')).not.toContain('仓库机')
  })

  it('says so when the preset names a deleted printer', async () => {
    printers = [PRINTERS[0]!]
    presets = [{ ...PRESET, printerId: 'prn-gone' }]
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByText(/打印机已被删除/)).toBeDefined()
  })

  it('says so when the preset names deleted print settings', async () => {
    profiles = [PROFILES[0]!]
    presets = [{ ...PRESET, profileId: 'prf-gone' }]
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByText(/打印参数已被删除/)).toBeDefined()
  })

  it('still selects the printer when only the profile is gone', async () => {
    // One missing reference should not cost the other three.
    profiles = [PROFILES[0]!]
    presets = [{ ...PRESET, profileId: 'prf-gone' }]
    land('/design/tpl-7?preset=pre-1')
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
  })

  it('keeps the design the address named when the preset points at another', async () => {
    // Swapping the label out from under somebody who clicked a specific one is
    // worse than the settings being wrong: they would print the other label
    // believing it was this one.
    presets = [{ ...PRESET, templateId: 'tpl-other' }]
    land('/design/tpl-7?preset=pre-1')
    expect(await screen.findByText(/指向的是另一张标签/)).toBeDefined()
    await waitFor(() => expect(selectValue('打印机')).toContain('仓库机'))
  })
})
