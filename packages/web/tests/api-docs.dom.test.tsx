/**
 * The API console.
 *
 * Constitution ("page reachability"): every page that can be navigated to needs
 * a render assertion, because a blank one is the cheapest failure to test and
 * the most embarrassing to ship.
 *
 * Swagger UI itself is loaded on demand — it is a megabyte of JavaScript that
 * nobody printing labels needs — so what is asserted here is the frame around
 * it: that the tab exists, that it says what it is, and that the fallback shown
 * while the chunk arrives is not a blank rectangle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { TAB_KINDS } from '../src/app/routes.ts'
import { pathForTab, tabFromPath } from '../src/app/routes.ts'

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('{}'),
    } as unknown as Response),
  ))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the route', () => {
  it('is one of the tab kinds', () => {
    expect(TAB_KINDS).toContain('api-docs')
  })

  it('has an address, and it round-trips', () => {
    // A page with no address cannot be linked to or restored after a refresh.
    const path = pathForTab({ kind: 'api-docs' })
    expect(path).toBe('/api-docs')
    expect(tabFromPath(path)).toEqual({ kind: 'api-docs' })
  })
})

describe('the page', () => {
  it('opens from the sidebar and renders something', async () => {
    render(wrap(<App />))
    const nav = document.querySelector('nav')!
    const entry = [...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === '接口调试')
    expect(entry, 'no sidebar entry for the API console').toBeDefined()
    fireEvent.click(entry!)

    // The console arrives in its own chunk; what must be on screen immediately
    // is a page that says what it is rather than an empty panel. Scoped to the
    // page, because the sidebar entry carries the same words.
    const page = await screen.findByTestId('api-docs')
    expect(within(page).getByRole('heading', { name: '接口调试' })).toBeDefined()
  })

  it('says where the document comes from', async () => {
    // So somebody can fetch it with curl, or point another tool at it, without
    // reading the source to find the path.
    render(wrap(<App />))
    const nav = document.querySelector('nav')!
    fireEvent.click([...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === '接口调试')!)
    const page = await screen.findByTestId('api-docs')
    expect(within(page).getByRole('link', { name: '/api/openapi.json' })).toBeDefined()
  })
})
