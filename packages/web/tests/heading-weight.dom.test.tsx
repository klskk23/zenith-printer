/**
 * Headings are the body face at weight 500 — never bolder.
 *
 * Nocturne's hierarchy is size and space, not weight, and a bold heading on
 * its dark ground reads as shouting. A previous version set headings in a
 * serif; before that they were `font-semibold`. Both are the same mistake
 * from opposite directions: giving the heading a voice of its own.
 *
 * Asserted on the class list — a structural fact about the markup — rather
 * than on a computed style happy-dom cannot resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { PageHeader } from '../src/components/page-header.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

const BOLD = /\bfont-(?:semibold|bold|extrabold|black)\b/

function headings(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3'))
}

describe('heading weight', () => {
  it('is medium on the page header', () => {
    render(<PageHeader title="打印机" />)
    const heading = screen.getByRole('heading', { name: '打印机' })
    expect(heading.className).toMatch(/\bfont-medium\b/)
    expect(heading.className).not.toMatch(BOLD)
  })

  it.each(['打印机', '打印队列', '打印历史', '设置', '模板库'])('is never bold on the %s page', (label) => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText(label)[0]!)
    const bold = headings().filter((h) => BOLD.test(h.className))
    expect(bold.map((h) => `${h.tagName}: ${h.textContent}`)).toEqual([])
    expect(headings().length).toBeGreaterThan(0)
  })
})
