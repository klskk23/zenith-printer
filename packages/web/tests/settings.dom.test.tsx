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
import { chooseOption, selectedText } from './support/select.ts'

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

function openSettings(): HTMLElement {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('设置')[0]!)
  // By its label rather than by scanning for a select that happens to contain
  // "深色": a Radix trigger shows only the *chosen* option, so a text scan
  // would find it only while dark was already selected.
  return screen.getByRole('combobox', { name: '主题' })
}

/**
 * Changed away from dark, not toward it: dark is the default now, so choosing
 * it is not a change and these tests would assert nothing.
 */
describe('draft editing', () => {
  it('does not apply a change immediately', () => {
    const theme = openSettings()
    chooseOption(theme, '浅色')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('reports that something is unsaved', () => {
    const theme = openSettings()
    chooseOption(theme, '浅色')
    expect(screen.getAllByText('有未保存的修改').length).toBeGreaterThan(0)
  })

  it('applies the change on save', () => {
    const theme = openSettings()
    chooseOption(theme, '浅色')
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('discards the change on cancel', () => {
    const theme = openSettings()
    chooseOption(theme, '浅色')
    fireEvent.click(screen.getAllByText('取消')[0]!)

    // Reads what the control *shows*, which is what the operator sees. The
    // hidden value it used to read could stay right while the label went wrong.
    expect(selectedText(theme)).toContain('深色')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
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
    chooseOption(theme, '浅色')
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('unmarks it for "follow system"', () => {
    const theme = openSettings()
    chooseOption(theme, '跟随系统')
    fireEvent.click(screen.getAllByText('保存')[0]!)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })
})

describe('the default', () => {
  /**
   * A label editor is looked at for hours against a white canvas that cannot
   * be darkened — the paper has to look like paper — so the surroundings are
   * the only thing that can rest the eyes.
   */
  it('is dark before anyone chooses anything', () => {
    openSettings()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('is what the theme selector shows', () => {
    expect(selectedText(openSettings())).toContain('深色')
  })
})
