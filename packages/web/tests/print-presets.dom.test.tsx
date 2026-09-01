/**
 * The print presets page.
 *
 * Constitution ("page reachability"): every page that can be navigated to needs
 * a render assertion, because a blank one is the cheapest failure to test and
 * the most embarrassing to ship.
 *
 * Beyond that, the thing worth asserting is the id. A preset exists so another
 * system can print without knowing what a template is; that system is
 * configured with the id, so the id has to be *on the page*, whole. Everywhere
 * else in this application an id is an implementation detail shown eight
 * characters at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrintPresetsPage } from '../src/pages/print-presets-page.tsx'
import { TAB_KINDS, pathForTab, tabFromPath } from '../src/app/routes.ts'

const PRESET = {
  id: '75a4c13c-b232-42eb-98ee-90954b7a5426',
  name: '路由器标签',
  templateId: 'tpl-1',
  printerId: 'prn-1',
  profileId: null,
  copies: 2,
  createdAt: 'T',
  updatedAt: 'T',
}

const posted: Array<Record<string, unknown>> = []
const patched: Array<{ id: string; body: Record<string, unknown> }> = []
const deleted: string[] = []
let presets: Array<Record<string, unknown>>

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  posted.length = 0
  patched.length = 0
  deleted.length = 0
  presets = [PRESET]
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/print-presets') && init?.method === 'PATCH') {
      patched.push({
        id: url.split('/').pop() ?? '',
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      })
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(PRESET),
        text: () => Promise.resolve(JSON.stringify(PRESET)),
      } as unknown as Response)
    }
    if (url.includes('/print-presets') && init?.method === 'DELETE') {
      deleted.push(url.split('/').pop() ?? '')
      return Promise.resolve({
        ok: true, status: 204,
        headers: new Headers(),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as unknown as Response)
    }
    if (url.includes('/print-presets') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Promise.resolve({
        ok: true, status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(PRESET),
        text: () => Promise.resolve(JSON.stringify(PRESET)),
      } as unknown as Response)
    }
    const body = url.includes('/print-presets')
      ? { presets }
      : url.includes('/profiles')
        ? { profiles: [
            { id: 'prof-1', printerId: 'prn-1', name: '默认', density: 3, labelType: 1, labelWidthMm: 50, labelHeightMm: 30, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: true, halftone: 'none', threshold: 128, createdAt: 'T' },
            { id: 'prof-2', printerId: 'prn-1', name: '浓度 4', density: 4, labelType: 1, labelWidthMm: 50, labelHeightMm: 30, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: false, halftone: 'none', threshold: 128, createdAt: 'T' },
          ] }
      : url.includes('/templates')
        ? { templates: [{ id: 'tpl-1', name: '路由器面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203, elements: [], variables: [], dataSourceId: null, createdAt: 'T', updatedAt: 'T', version: 1, bindingIssue: null }] }
        : url.includes('/printers')
          ? { printers: [{ id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/x', capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null, createdAt: 'T', offsetXDots: 0, offsetYDots: 0 }] }
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
})

describe('the route', () => {
  it('is one of the tab kinds', () => {
    expect(TAB_KINDS).toContain('print-presets')
  })

  it('has an address, and it round-trips', () => {
    const path = pathForTab({ kind: 'print-presets' })
    expect(path).toBe('/print-presets')
    expect(tabFromPath(path)).toEqual({ kind: 'print-presets' })
  })
})

describe('the page', () => {
  it('renders the presets that exist', async () => {
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText('路由器标签')).toBeDefined()
  })

  it('shows the id whole, because that is what the other system is given', async () => {
    // Not truncated: it goes into somebody else's configuration file.
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText(PRESET.id)).toBeDefined()
  })

  it('says what it is pointed at', async () => {
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText(/路由器面单/)).toBeDefined()
    expect(await screen.findByText(/B3S_P/)).toBeDefined()
  })

  it('says so when the design behind one is gone', async () => {
    // A preset naming a deleted design cannot print; showing a blank where a
    // name goes reads as missing data rather than as a broken preset.
    presets = [{ ...PRESET, templateId: 'deleted' }]
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText(/设计已被删除/)).toBeDefined()
  })

  it('offers an empty state once the answer is in', async () => {
    presets = []
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText(/还没有预设/)).toBeDefined()
  })

  it('does not claim to be empty while it is still loading', async () => {
    // Same rule as the home page: `data ?? []` made "not here" and "not here
    // yet" the same length.
    presets = []
    render(wrap(<PrintPresetsPage />))
    expect(screen.queryByText(/还没有预设/)).toBeNull()
  })
})

describe('creating one', () => {
  it('will not submit until it has a name, a design and a printer', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    const save = await screen.findByRole('button', { name: '保存' })
    expect(save.hasAttribute('disabled')).toBe(true)
  })

  it('sends what was chosen', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '新预设' },
    })

    // Radix selects: opened on pointerdown, chosen by clicking the option.
    fireEvent.pointerDown(screen.getByRole('combobox', { name: '设计' }), { pointerType: 'mouse', button: 0 })
    fireEvent.click(await screen.findByRole('option', { name: '路由器面单' }))
    fireEvent.pointerDown(screen.getByRole('combobox', { name: '打印机' }), { pointerType: 'mouse', button: 0 })
    fireEvent.click(await screen.findByRole('option', { name: 'B3S_P' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ name: '新预设', templateId: 'tpl-1', printerId: 'prn-1', copies: 1 })
  })
})

/**
 * The print settings.
 *
 * A preset is a name over four decisions, and the page offered three. The
 * fourth — density, speed, label type — decides whether the barcode scans, and
 * leaving it out meant every preset printed at whatever the printer's default
 * profile happened to be. The server has stored and honoured `profileId` all
 * along; nothing ever sent it one.
 */
describe('the print settings', () => {
  it('are offered when the chosen printer has profiles', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印机' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: 'B3S_P' }))
    expect(await screen.findByRole('combobox', { name: '打印参数' })).toBeDefined()
  })

  it('are sent with the preset', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '路由器标签' },
    })
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '设计' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: '路由器面单' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印机' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: 'B3S_P' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印参数' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: /浓度 4/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ profileId: 'prof-2' })
  })

  it('lets the printer decide, which is what a preset without one means', async () => {
    // Not the same as "no settings": it means whichever profile that printer
    // is set to use, which is the answer somebody standing at it already
    // chose. Made sayable rather than only reachable by never touching the
    // control, so a preset can be moved back to it.
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印机' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: 'B3S_P' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印参数' }), {
      pointerType: 'mouse', button: 0,
    })
    expect(await screen.findByRole('option', { name: /打印机默认/ })).toBeDefined()
  })

  it('shows on an existing preset which settings it prints with', async () => {
    presets = [{ ...PRESET, profileId: 'prof-2' }]
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByText(/浓度 4/)).toBeDefined()
  })
})

/**
 * Creating and editing, both in a dialog.
 *
 * The form used to sit open at the top of the page, which put a five-field
 * form above the list on every visit — and the list is what somebody comes
 * here for. More importantly there was no way to change a preset at all: the
 * id is written into somebody else's configuration, so the only way to fix a
 * wrong printer was to delete the preset and hand over a new id, which is
 * exactly what a preset exists to avoid.
 */
describe('the create dialog', () => {
  it('is behind a button, so the list is what the page opens on', async () => {
    render(wrap(<PrintPresetsPage />))
    expect(await screen.findByRole('button', { name: '新建预设' })).toBeDefined()
    // Nothing to fill in until it is asked for.
    expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull()
  })

  it('creates from inside the dialog', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '新建预设' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '新预设' },
    })
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '设计' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: '路由器面单' }))
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '打印机' }), {
      pointerType: 'mouse', button: 0,
    })
    fireEvent.click(await screen.findByRole('option', { name: 'B3S_P' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ name: '新预设', templateId: 'tpl-1', printerId: 'prn-1' })
  })
})

describe('the edit dialog', () => {
  it('opens on a preset already filled in', async () => {
    // Otherwise editing means retyping what is already there, and a field left
    // blank by mistake is a change nobody meant to make.
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
        '路由器标签',
      ),
    )
    expect((screen.getByRole('spinbutton', { name: '每行份数' }) as HTMLInputElement).value).toBe('2')
  })

  it('sends only to that preset, and keeps its id', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '改过的名字' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]?.id).toBe(PRESET.id)
    expect(patched[0]?.body).toMatchObject({ name: '改过的名字' })
  })

  it('carries the copies through untouched when only the name changed', async () => {
    // The server used to reset them; this side must not hand it an excuse by
    // omitting what it did not change either.
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '改过的名字' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]?.body).toMatchObject({ copies: 2 })
  })

  it('does not keep a cancelled edit for the next time it opens', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), {
      target: { value: '半路改的' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
        '路由器标签',
      ),
    )
    expect(patched).toHaveLength(0)
  })

  it('still deletes, and only the one asked for', async () => {
    render(wrap(<PrintPresetsPage />))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除', hidden: false }))
    await waitFor(() => expect(deleted).toEqual([PRESET.id]))
  })
})
