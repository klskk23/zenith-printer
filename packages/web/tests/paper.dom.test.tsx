/**
 * The paper is one thing, drawn one way, wherever a label is shown.
 *
 * The canvas, a thumbnail and a print preview are all pictures of the same
 * sheet, and the rule "white means this will be printed" only holds if they
 * all say white the same way. So they share one class, `paper`, and this
 * checks that each of them carries it — and that none has kept a private
 * `bg-white` from before, which would drift the day `.paper` changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { ThumbnailFrame } from '../src/features/templates/thumbnail-frame.tsx'
import type { Template } from '../src/features/templates/hooks.ts'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

const template = {
  id: 'tpl-1',
  name: '货架标签',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [],
  variables: [],
  dataSourceId: null,
  hasThumbnail: false,
  version: 1,
} as unknown as Template

describe('the paper class', () => {
  it('is on the canvas', () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
    const canvas = document.querySelector('[data-label-canvas]')
    expect(canvas).not.toBeNull()
    expect(canvas!.classList.contains('paper')).toBe(true)
  })

  it('is on a thumbnail, which no longer paints its own white', () => {
    render(wrap(<ThumbnailFrame template={template} />))
    const frame = document.querySelector('[data-thumbnail-frame]')
    expect(frame).not.toBeNull()
    expect(frame!.classList.contains('paper')).toBe(true)
    expect(frame!.className).not.toMatch(/\bbg-white\b/)
  })
})
