import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { copy } from '../src/i18n/index.ts'

function renderApp(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok' })))))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Classical application shell', () => {
  it('renders the branded shell landmarks and connection state', async () => {
    renderApp()

    expect(screen.getByText('Zenith Printer')).toBeDefined()
    expect(document.querySelector('[data-classical-shell]')).not.toBeNull()
    expect(document.querySelector('[data-classical-sidebar]')).not.toBeNull()
    expect(document.querySelector('[data-classical-tab-bar]')).not.toBeNull()
    expect(await screen.findByText(copy.connection.connected)).toBeDefined()
  })

  it('keeps sidebar navigation opening the requested path', () => {
    renderApp()

    fireEvent.click(screen.getByRole('button', { name: '数据源' }))

    expect(window.location.pathname).toBe('/data-sources')
  })
})
