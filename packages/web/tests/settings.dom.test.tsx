/**
 * Settings are edited as a draft.
 *
 * Applying each keystroke made the page impossible to explore: changing the
 * language mid-thought reloaded every label around you, with no way back except
 * remembering what it had been.
 *
 * These used to be driven through the theme selector, which is gone — there is
 * one palette now. They run on the language selector instead, which is the
 * setting the paragraph above is actually about, and the one whose effect is
 * visible on the page rather than only in storage: this environment has no
 * `localStorage`, so a test that watched what was written down would be
 * watching nothing.
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

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

function openSettings(): HTMLElement {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('设置')[0]!)
  // By its label rather than by scanning for a select that happens to contain
  // "中文": a Radix trigger shows only the *chosen* option, so a text scan
  // would find it only while Chinese was already selected.
  return screen.getByRole('combobox', { name: '界面语言' })
}

describe('draft editing', () => {
  it('does not apply a change immediately', () => {
    const language = openSettings()
    chooseOption(language, 'English')
    // Still Chinese: the page around the setting has not moved.
    expect(screen.getAllByText('保存').length).toBeGreaterThan(0)
  })

  it('reports that something is unsaved', () => {
    const language = openSettings()
    chooseOption(language, 'English')
    expect(screen.getAllByText('有未保存的修改').length).toBeGreaterThan(0)
  })

  it('applies the change on save', () => {
    const language = openSettings()
    chooseOption(language, 'English')
    fireEvent.click(screen.getAllByText('保存')[0]!)
    // Every label on the page moves at once, which is the whole reason this is
    // a draft rather than applied per keystroke.
    expect(screen.getAllByText('Save').length).toBeGreaterThan(0)
  })

  it('discards the change on cancel', () => {
    const language = openSettings()
    chooseOption(language, 'English')
    fireEvent.click(screen.getAllByText('取消')[0]!)

    // Reads what the control *shows*, which is what the operator sees. The
    // hidden value it used to read could stay right while the label went wrong.
    expect(selectedText(language)).toContain('中文')
    expect(screen.getAllByText('保存').length).toBeGreaterThan(0)
  })

  it('disables both buttons when nothing has changed', () => {
    openSettings()
    const save = screen.getAllByText('保存')[0]! as HTMLButtonElement
    const cancel = screen.getAllByText('取消')[0]! as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
  })
})

describe('the palette', () => {
  /**
   * There is one, and it is not a setting.
   *
   * Dark mode was dropped: it doubled every colour token and existed mainly to
   * rest the eyes against a white canvas, which the paper-grey ground now does
   * without a second palette to keep in step. Asserted here because "somebody
   * will just add the dropdown back" is exactly how a second palette returns.
   */
  it('is not offered as a choice', () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('设置')[0]!)
    expect(screen.queryByRole('combobox', { name: '主题' })).toBeNull()
  })

  it('leaves the document root unmarked', () => {
    render(wrap(<App />))
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })
})
