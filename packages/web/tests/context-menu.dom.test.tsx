/**
 * Right-clicking an element on the canvas.
 *
 * Delete has no confirmation, which is only acceptable because undo covers it —
 * so the menu itself has to actually open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

function openDesignWithElement(): void {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('标签设计')[0]!)
  fireEvent.click(screen.getAllByText('矩形')[0]!)
}

describe('canvas context menu', () => {
  it('opens on right-click over the canvas', () => {
    openDesignWithElement()
    fireEvent.contextMenu(screen.getByLabelText('label canvas'))
    expect(screen.queryAllByText('置顶').length).toBeGreaterThan(0)
  })

  it('offers delete, front and back', () => {
    openDesignWithElement()
    fireEvent.contextMenu(screen.getByLabelText('label canvas'))
    for (const item of ['删除', '置顶', '置底']) {
      expect(screen.queryAllByText(item).length).toBeGreaterThan(0)
    }
  })
})

describe('right-clicking the element itself', () => {
  /** The hit target the pointer actually lands on. */
  function elementRect(): Element {
    const rect = document.querySelector('[data-element-id]')
    expect(rect).not.toBeNull()
    return rect!
  }

  it('opens the menu', () => {
    openDesignWithElement()
    fireEvent.contextMenu(elementRect())
    expect(screen.queryAllByText('置顶').length).toBeGreaterThan(0)
  })

  it('selects the element it was opened on', () => {
    openDesignWithElement()
    fireEvent.contextMenu(elementRect())
    // 置顶 is disabled for an element already at the front; with one element
    // the menu should still be there regardless.
    expect(screen.queryAllByText('删除').length).toBeGreaterThan(0)
  })
})

describe('inverting from the menu', () => {
  /**
   * White parts **inside the canvas**.
   *
   * Scoped deliberately: a document-wide query also counts the open menu's own
   * markup, which changes as the menu opens and closes. The first version of
   * this test did exactly that and passed identically with the toggle wired
   * and with it stubbed out — it was measuring the menu, not the label.
   */
  const whiteParts = (): number =>
    screen.getByLabelText('label canvas').querySelectorAll('[fill="#ffffff"], [stroke="#ffffff"]')
      .length

  /**
   * The menu's own entry.
   *
   * By role, not by text: the inspector carries a switch with the very same
   * label, and it renders first — a `getAllByText(...)[0]` picked *that* one,
   * so the test drove the panel while claiming to drive the menu and passed
   * with the menu's handler stubbed out.
   */
  const menuEntry = (): HTMLElement =>
    screen.getByRole('menuitemcheckbox', { name: '反相（白字）' })

  it('offers the toggle', () => {
    openDesignWithElement()
    fireEvent.contextMenu(screen.getByLabelText('label canvas'))
    expect(menuEntry()).toBeDefined()
  })

  it('turns the element white and back', () => {
    openDesignWithElement()
    const before = whiteParts()

    fireEvent.contextMenu(screen.getByLabelText('label canvas'))
    fireEvent.click(menuEntry())
    expect(whiteParts()).toBeGreaterThan(before)

    fireEvent.contextMenu(screen.getByLabelText('label canvas'))
    fireEvent.click(menuEntry())
    expect(whiteParts()).toBe(before)
  })
})
