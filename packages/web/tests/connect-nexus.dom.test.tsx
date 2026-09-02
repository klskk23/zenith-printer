/**
 * Connecting a data source to a category of the asset ledger.
 *
 * The feature is what the dialog **does not** ask for. An address, a key and a
 * key column were all things somebody had to type correctly and then keep in
 * step with the environment they were copied from; now there is one dropdown.
 * So the tests are mostly about absence, which is the kind of thing that
 * quietly comes back.
 *
 * The entry point disappearing when the ledger is not configured is the other
 * half: a button that cannot work is worse than no button, because the only
 * way to discover it is to press it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectNexusDialog, depthOf } from '../src/features/data-sources/connect-nexus-dialog.tsx'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'

const CATEGORIES = [
  { id: 'cat-net', code: 'NET', name: '网络设备', parent_id: null, path: '/cat-net/' },
  { id: 'cat-router', code: 'SEEDRT', name: '种子路由器', parent_id: 'cat-net', path: '/cat-net/cat-router/' },
]

const posted: Array<{ url: string; body: Record<string, unknown> }> = []
let configured: boolean
let categoriesFail: boolean
let categories: typeof CATEGORIES

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  posted.length = 0
  configured = true
  categoriesFail = false
  categories = CATEGORIES
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      Promise.resolve({
        ok: status < 400, status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)

    if (url.includes('/nexus/categories/') && url.endsWith('/columns')) {
      return json({ columns: ['sys_id', 'sys_sn', 'mac'], total: 30 })
    }
    if (url.includes('/nexus/categories')) {
      if (categoriesFail) {
        return json({ code: 'NEXUS_UNAUTHORISED', what: '资产台账不认这台机器的密钥', why: '', next: '' }, 422)
      }
      return json({ configured, categories: configured ? categories : [] })
    }
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return json({ id: 'ds-1', name: '种子路由器', sourceKind: 'nexus' }, 201)
    }
    if (url.includes('/data-sources')) return json({ dataSources: [] })
    if (url.includes('/google/status')) return json({ configured: false, clientEmail: null })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openDialog = (): void => {
  render(wrap(<ConnectNexusDialog open onOpenChange={() => undefined} />))
}

describe('what it asks for', () => {
  it('offers the categories the ledger reported', async () => {
    openDialog()
    expect(await screen.findByRole('combobox', { name: '类别' })).toBeDefined()
  })

  it('asks for nothing else that has to be kept in step with the environment', async () => {
    // Every field that is not here is one nobody can get wrong, and one value
    // that cannot drift from the deployment it was copied from.
    //
    // Asserted on the *fields*, not on the prose: the explanation says the
    // words 地址 and 密钥 out loud, which is the point — it tells somebody
    // where those live instead of leaving them wondering why nothing asks.
    openDialog()
    await screen.findByRole('combobox', { name: '类别' })
    const dialog = document.querySelector('[data-connect-nexus]')!

    expect(dialog.querySelectorAll('input')).toHaveLength(1) // the optional name
    expect(dialog.querySelectorAll('textarea')).toHaveLength(0) // no header box
    expect(dialog.querySelectorAll('[role="combobox"]')).toHaveLength(1) // the category
  })

  it('shows the columns of the chosen category before anything is created', async () => {
    // Otherwise the next step — writing ${…} into a design — means creating
    // the source, refreshing it, and going to look.
    openDialog()
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '类别' }), { pointerType: 'mouse', button: 0 })
    fireEvent.click(await screen.findByRole('option', { name: /种子路由器/ }))
    expect(await screen.findByText(/sys_sn/)).toBeDefined()
  })

  it('sends only the category', async () => {
    openDialog()
    fireEvent.pointerDown(await screen.findByRole('combobox', { name: '类别' }), { pointerType: 'mouse', button: 0 })
    fireEvent.click(await screen.findByRole('option', { name: /种子路由器/ }))
    fireEvent.click(screen.getByRole('button', { name: '接入' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]?.body).toEqual({ categoryId: 'cat-router' })
  })

  it('will not submit before a category is chosen', async () => {
    openDialog()
    await screen.findByRole('combobox', { name: '类别' })
    expect(screen.getByRole('button', { name: '接入' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('when the ledger will not answer', () => {
  it('says which failure it was, rather than showing an empty dropdown', async () => {
    // A select with no options is a dead end that looks like a loading state.
    categoriesFail = true
    openDialog()
    expect(await screen.findByText(/不认这台机器的密钥/)).toBeDefined()
    expect(screen.queryByRole('combobox', { name: '类别' })).toBeNull()
  })

  it('says so when the ledger has no categories at all', async () => {
    categories = []
    openDialog()
    expect(await screen.findByText(/还没有类别/)).toBeDefined()
  })

  it('survives an answer that is missing the list entirely', async () => {
    // A throw during render takes the whole page with it — blank, with the
    // error only in the console. A dropdown is not worth that.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ configured: true }),
        text: () => Promise.resolve('{}'),
      } as unknown as Response),
    ))
    openDialog()
    expect(await screen.findByRole('button', { name: '接入' })).toBeDefined()
  })
})

describe('the entry point on the list page', () => {
  it('is offered when the deployment configured the ledger', async () => {
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByRole('button', { name: '从资产台账接入' })).toBeDefined()
  })

  it('is offered when the ledger is configured but not answering', async () => {
    /**
     * Configured-and-broken is not the same as not configured, and hiding the
     * entry for both makes a fixable fault look like a deployment decision.
     *
     * That is exactly how it failed in the field: the ledger was configured
     * and unreachable, the entry vanished, and the carefully worded "cannot
     * reach the ledger" was behind a button that was no longer there.
     */
    categoriesFail = true
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByRole('button', { name: '从资产台账接入' })).toBeDefined()
  })

  it('is not there at all when it did not', async () => {
    // Same answer the Google entry gives: a button that cannot work is worse
    // than no button, because pressing it is the only way to find out.
    configured = false
    render(wrap(<DataSourcesPage />))

    /**
     * Waits for the answer before asserting the absence.
     *
     * Rendering the page and looking immediately proves nothing: the entry is
     * absent for the first frame whatever the answer turns out to be, so the
     * assertion passed even against a page that showed the button the moment
     * the query resolved.
     */
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
          String(url).includes('/nexus/categories'),
        ),
      ).toBe(true),
    )
    await screen.findByRole('button', { name: '上传 CSV' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '链接 Google 表格' })).toBeDefined())

    expect(screen.queryByRole('button', { name: '从资产台账接入' })).toBeNull()
  })
})

describe('indenting the tree', () => {
  it('reads the depth out of the path the ledger already sent', () => {
    expect(depthOf(CATEGORIES[0]!)).toBe(0)
    expect(depthOf(CATEGORIES[1]!)).toBe(1)
  })

  it('treats a missing path as no indent rather than an error', () => {
    // Indenting is cosmetic; the list reads fine without it.
    expect(depthOf({ id: 'x', code: 'X', name: 'x' })).toBe(0)
    expect(depthOf({ id: 'x', code: 'X', name: 'x', path: '' })).toBe(0)
  })
})
