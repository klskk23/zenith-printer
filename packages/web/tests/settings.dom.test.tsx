/**
 * Settings are edited as a draft.
 *
 * Applying each keystroke made the page impossible to explore: changing the
 * language mid-thought reloaded every label around you, with no way back except
 * remembering what it had been.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

function openSettings(): HTMLSelectElement {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('设置')[0]!)
  const selects = [...document.querySelectorAll('select')]
  return selects.find((el) => el.textContent?.includes('深色')) as HTMLSelectElement
}

describe('draft editing', () => {
  it('does not apply a change immediately', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('reports that something is unsaved', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    expect(screen.getAllByText('有未保存的修改').length).toBeGreaterThan(0)
  })

  it('applies the change on save', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('discards the change on cancel', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    fireEvent.click(screen.getAllByText('取消')[0]!)

    expect(theme.value).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('disables both buttons when nothing has changed', () => {
    openSettings()
    const save = screen.getAllByText('保存')[0]! as HTMLButtonElement
    const cancel = screen.getAllByText('取消')[0]! as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
  })
})

describe('the theme actually takes effect', () => {
  it('marks the document root', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('unmarks it for "follow system"', () => {
    const theme = openSettings()
    fireEvent.change(theme, { target: { value: 'dark' } })
    fireEvent.click(screen.getAllByText('保存')[0]!)

    fireEvent.change(theme, { target: { value: 'system' } })
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })
})
