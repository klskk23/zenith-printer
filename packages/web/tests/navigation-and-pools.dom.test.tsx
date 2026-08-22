/**
 * Where things live in the navigation.
 *
 * Two placements with reasons behind them:
 *
 *   - Settings sits last. It is where somebody goes once and rarely again, so
 *     the day-to-day entries should not be below it.
 *   - Sequence pools sit with the data sources. They used to be on the settings
 *     page, which opens by saying its settings only affect this browser — and a
 *     pool is server state that everybody draws serials from. What a pool and a
 *     table have in common is that both are where a variable gets its value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'
import { SettingsPage } from '../src/pages/settings-page.tsx'
import { PreferencesProvider } from '../src/features/preferences/context.tsx'
import { TAB_KINDS } from '../src/app/routes.ts'

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/sequence-pools')) {
      return json({ pools: [{ id: 'p-1', name: '出货号', digits: 6, step: 1, floor: 0, nextValue: 1, createdAt: 'T' }] })
    }
    if (url.includes('/google/status')) return json({ configured: false, clientEmail: null })
    if (url.includes('/data-sources')) return json({ dataSources: [] })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the sidebar order', () => {
  it('puts settings last', () => {
    // Asserted on the rendered list, not on the constant: the sidebar filters
    // one entry out, so the constant alone does not say what people see.
    render(wrap(<App />))
    const nav = document.querySelector('nav')!
    const labels = [...nav.querySelectorAll('button')].map((b) => b.textContent?.trim())

    expect(labels.at(-1)).toBe('设置')
  })

  it('keeps data sources above it, where the day-to-day work is', () => {
    render(wrap(<App />))
    const nav = document.querySelector('nav')!
    const labels = [...nav.querySelectorAll('button')].map((b) => b.textContent?.trim())

    expect(labels.indexOf('数据源')).toBeLessThan(labels.indexOf('设置'))
  })

  it('still never offers the data source editor as an entry', () => {
    // It needs a table to open; an entry that opened an empty one is a dead end.
    render(wrap(<App />))
    const nav = document.querySelector('nav')!
    expect(nav.querySelectorAll('button')).toHaveLength(TAB_KINDS.length - 1)
  })
})

describe('where sequence pools live', () => {
  it('is the data sources page', async () => {
    render(wrap(<DataSourcesPage />))
    expect(await screen.findByText('出货号')).toBeDefined()
    expect(document.querySelector('[data-sequence-pools]')).not.toBeNull()
  })

  it('is no longer the settings page', async () => {
    // Settings says its settings only affect this browser. A pool is server
    // state everybody shares, so it was contradicting the page it sat on.
    render(
      wrap(
        <PreferencesProvider>
          <SettingsPage />
        </PreferencesProvider>,
      ),
    )
    await screen.findByText(/只影响当前浏览器/)
    expect(document.querySelector('[data-sequence-pools]')).toBeNull()
  })
})

describe('the too-many-tabs advice', () => {
  /** Open a sidebar entry by its label. */
  const openTab = (label: string): void => {
    const nav = document.querySelector('nav')!
    const entry = [...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
    fireEvent.click(entry!)
  }

  it('stays quiet when the pages carry the tab count over the threshold', () => {
    // Nine designs and six list pages is fifteen tabs — well past the
    // threshold by raw count, and still nine of the kind the advice is about.
    // Counting the pages would fire it here, which is the mistake this guards.
    render(wrap(<App />))
    for (let i = 0; i < 9; i += 1) {
      openTab('标签设计')
    }
    for (const label of ['数据源', '打印机', '打印队列', '打印历史', '设置']) {
      openTab(label)
    }

    expect(document.querySelectorAll('[data-tab-bar] > div').length).toBeGreaterThan(10)
    expect(screen.queryByText(/可能影响编辑流畅度/)).toBeNull()
  })

  it('appears once enough design tabs are open', () => {
    render(wrap(<App />))
    // The design entry opens a fresh tab each time — comparing variants is a
    // normal thing to do, which is exactly why the advice exists.
    for (let i = 0; i < 10; i += 1) {
      openTab('标签设计')
    }
    expect(screen.getByText(/可能影响编辑流畅度/)).toBeDefined()
  })

  it('says how many are open rather than repeating the threshold', () => {
    render(wrap(<App />))
    for (let i = 0; i < 12; i += 1) {
      openTab('标签设计')
    }
    expect(screen.getByText(/12 个设计与模板标签页/)).toBeDefined()
  })
})
