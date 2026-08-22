/**
 * The home page's recent-templates list.
 *
 * It shows the same thing the library does — a design — and had drifted into
 * showing it differently: two lines of text with no picture. The frame is now
 * one component used by both, so an adjustment to one cannot leave the other
 * behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IndexPage } from '../src/pages/index-page.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'

const TEMPLATE = {
  id: 'tpl-1',
  name: '面单',
  printerKind: 'niimbot',
  widthMm: 100,
  heightMm: 20,
  dpi: 203,
  elements: [],
  variables: [],
  dataSourceId: null,
  bindingIssue: null,
  createdAt: 'T',
  updatedAt: 'T',
  version: 3,
  hasThumbnail: true,
}

let templates: Array<Record<string, unknown>>

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  templates = [{ ...TEMPLATE }]
  window.history.replaceState(null, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/templates')
        ? { templates }
        : url.includes('/print-jobs')
          ? { jobs: [] }
          : url.includes('/printers')
            ? { printers: [] }
            : {}
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('recent templates on the home page', () => {
  it('mounts and lists the designs', async () => {
    expect(() => render(wrap(<IndexPage />))).not.toThrow()
    expect(await screen.findByText('面单')).toBeDefined()
  })

  it('shows the picture, as the library does', async () => {
    render(wrap(<IndexPage />))
    await screen.findByText('面单')
    const image = document.querySelector('[data-thumbnail]') as HTMLImageElement | null
    expect(image).not.toBeNull()
    expect(image!.getAttribute('src')).toBe('/api/templates/tpl-1/thumbnail?v=3')
  })

  it('gives the frame the label shape here too, not a fixed box', async () => {
    render(wrap(<IndexPage />))
    await screen.findByText('面单')
    const frame = document.querySelector('[data-thumbnail-frame]') as HTMLElement
    const ratio = Number.parseFloat(frame.style.width) / Number.parseFloat(frame.style.height)
    expect(ratio).toBeCloseTo(5, 1)
  })

  it('keeps the frame inside this list s narrower cards', async () => {
    // The home page's cards sit in a column of other sections, so the budget
    // is smaller than the library's — the numbers belong to the layout.
    render(wrap(<IndexPage />))
    await screen.findByText('面单')
    const frame = document.querySelector('[data-thumbnail-frame]') as HTMLElement
    expect(Number.parseFloat(frame.style.width)).toBeLessThanOrEqual(190)
  })

  it('sizes columns by available width, as the library does', async () => {
    render(wrap(<IndexPage />))
    await screen.findByText('面单')
    const grid = document.querySelector('[class*="auto-fill"]')
    expect(grid).not.toBeNull()
  })

  it('still says the size in millimetres', async () => {
    render(wrap(<IndexPage />))
    await screen.findByText('面单')
    expect(screen.getByText('100 × 20 mm')).toBeDefined()
  })
})
