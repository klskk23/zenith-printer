/**
 * Middle-click closes a tab, the way it does in a browser.
 *
 * The property that matters is not the closing — it is that the middle button
 * goes through the *same* door as the × does. A shortcut that closed a tab
 * with unsaved work outright would destroy it, and destroy it faster than the
 * button people were being careful with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { copy } from '../src/i18n/index.ts'

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

/** Open a page from the sidebar by its label. */
function openTab(label: string): void {
  const nav = document.querySelector('nav')!
  const entry = [...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  fireEvent.click(entry!)
}

const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-tab-bar] > div')]
const titleOf = (tab: HTMLElement): string => tab.querySelector('.whitespace-nowrap')?.textContent ?? ''
/**
 * A real middle click.
 *
 * `fireEvent.auxClick` is not in this version of testing-library, and a plain
 * `click` would not do: browsers fire `click` only for the primary button and
 * `auxclick` for the rest, which is the distinction the handler turns on.
 */
function auxClick(element: HTMLElement, button: number): void {
  fireEvent(element, new MouseEvent('auxclick', { button, bubbles: true, cancelable: true }))
}

describe('middle-clicking a tab', () => {
  it('closes it', () => {
    render(wrap(<App />))
    openTab('打印机')
    expect(tabs().map(titleOf)).toContain('打印机')

    auxClick(tabs().find((t) => titleOf(t) === '打印机')!, 1)
    expect(tabs().map(titleOf)).not.toContain('打印机')
  })

  it('leaves the other tabs alone', () => {
    render(wrap(<App />))
    openTab('打印机')
    openTab('打印队列')

    auxClick(tabs().find((t) => titleOf(t) === '打印机')!, 1)
    const remaining = tabs().map(titleOf)
    expect(remaining).toContain('打印队列')
    expect(remaining).toContain('首页')
  })

  it('asks first when the tab has unsaved work', async () => {
    // The whole reason this goes through requestClose. A middle click is easy
    // to do by accident — easier than finding a × that only appears on hover —
    // so it must not be the fast path to losing an afternoon.
    render(wrap(<App />))
    openTab('标签设计')
    const design = tabs().find((t) => titleOf(t).startsWith('未命名设计'))!

    // Make it dirty the way the editor does: put something on the canvas.
    await screen.findByLabelText('label canvas')
    fireEvent.click(screen.getByText('矩形'))
    await screen.findByTitle(copy.workspace.unsavedMark)

    auxClick(design, 1)
    expect(screen.getByRole('alertdialog')).toBeDefined()
    expect(tabs().map(titleOf).some((t) => t.startsWith('未命名设计'))).toBe(true)
  })

  it('ignores the right button', () => {
    // auxclick fires for every non-primary button. Closing on right-click would
    // take the tab away from under the context menu somebody just opened.
    render(wrap(<App />))
    openTab('打印机')

    auxClick(tabs().find((t) => titleOf(t) === '打印机')!, 2)
    expect(tabs().map(titleOf)).toContain('打印机')
  })

  it('still activates on a left click rather than closing', () => {
    render(wrap(<App />))
    openTab('打印机')
    openTab('打印队列')

    fireEvent.click(screen.getAllByText('打印机')[0]!)
    expect(tabs().map(titleOf)).toContain('打印机')
  })
})
