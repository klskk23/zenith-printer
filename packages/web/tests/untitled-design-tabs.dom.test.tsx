/**
 * Telling unsaved designs apart in the tab strip.
 *
 * Three blank designs all read 「未命名设计」, which is the one case where a tab
 * title says nothing at all — the strip exists so people can pick a tab without
 * clicking through them. The number is assigned when the tab opens and stays
 * put, so closing one does not relabel the others.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

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

/** Open a fresh blank design from the sidebar. */
function newDesign(): void {
  const nav = document.querySelector('nav')!
  const entry = [...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === '标签设计')
  fireEvent.click(entry!)
}

/** The titles in the tab strip, in order. */
function tabTitles(): string[] {
  return [...document.querySelectorAll('[data-tab-bar] > div')].map(
    (tab) => tab.querySelector('.whitespace-nowrap')?.textContent ?? '',
  )
}

describe('unsaved design tabs', () => {
  it('numbers them so two blank designs are two distinct titles', () => {
    render(wrap(<App />))
    newDesign()
    newDesign()

    const titles = tabTitles()
    expect(titles).toContain('未命名设计 1')
    expect(titles).toContain('未命名设计 2')
  })

  it('keeps each title put when another tab closes', () => {
    render(wrap(<App />))
    newDesign()
    newDesign()
    newDesign()

    const closes = screen.getAllByLabelText('关闭')
    fireEvent.click(closes[closes.length - 3]!)

    const titles = tabTitles()
    expect(titles).toContain('未命名设计 2')
    expect(titles).toContain('未命名设计 3')
    expect(titles).not.toContain('未命名设计 1')
  })
})
