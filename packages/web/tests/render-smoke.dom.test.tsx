/**
 * Does it render at all.
 *
 * Nothing asked this until a blank page shipped: 929 tests covering geometry,
 * snapping, undo and overflow, and not one of them mounted a component. A
 * white screen is the cheapest possible failure to catch and was the only one
 * with no test at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

// Vitest runs without `globals`, so Testing Library's own auto-cleanup hook is
// never registered; without this every render piles up in the same document.
afterEach(cleanup)

beforeEach(() => {
  // No server in this suite; every request simply fails, which is also the
  // state the app has to survive.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

describe('the shell', () => {
  it('mounts without throwing', () => {
    expect(() => render(wrap(<App />))).not.toThrow()
  })

  it('shows the product name', () => {
    render(wrap(<App />))
    expect(screen.getAllByText('Zenith Printer').length).toBeGreaterThan(0)
  })

  it('renders every sidebar entry', () => {
    render(wrap(<App />))
    for (const label of ['首页', '标签设计', '模板库', '打印机', '打印队列', '打印历史', '设置']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })
})

/**
 * Opening each sidebar entry.
 *
 * The design tab is the one that matters most and the one with the most moving
 * parts — canvas, rulers, inspector, layer panel, undo — so it is also the
 * easiest to break into a blank page.
 */
describe('opening a tab', () => {
  it.each(['标签设计', '模板库', '打印机', '打印队列', '打印历史', '设置'])(
    'renders %s without throwing',
    (label) => {
      render(wrap(<App />))
      const entry = screen.getAllByText(label)[0]!
      expect(() => fireEvent.click(entry)).not.toThrow()
    },
  )

  it('puts a canvas on the design tab', () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
  })
})
