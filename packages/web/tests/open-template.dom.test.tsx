/**
 * Opening a template from the library.
 *
 * The workspace records which template a design tab is for, and the editor was
 * never told — so opening "test" from the library produced an empty "untitled
 * design" and the template had to be chosen again by hand. Every existing test
 * passed throughout, because none of them opened a template with a template
 * actually present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const TEMPLATE = {
  id: 'tpl-1',
  name: 'test',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    {
      id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10,
      rotation: 0, strokeWidthDots: 2, filled: false, cornerRadiusMm: 0,
    },
  ],
  variableFields: [],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  version: 1,
}

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/templates') ? { templates: [TEMPLATE] } : {}
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

/** Wait for the template list to arrive and render. */
async function openLibrary(): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('模板库')[0]!)
  await screen.findAllByText('test')
}

describe('opening a template', () => {
  it('lists it in the library', async () => {
    await openLibrary()
    expect(screen.getAllByText('test').length).toBeGreaterThan(0)
  })

  it('opens a design tab named after the template, not "untitled"', async () => {
    await openLibrary()
    fireEvent.click(screen.getAllByText('打开')[0]!)
    await screen.findByLabelText('label canvas')

    // Scoped to the tab strip: the bug was that the tab said 未命名设计.
    const tabStrip = document.querySelector('[data-tab-bar]')!
    expect(tabStrip.textContent).toContain('test')
    expect(tabStrip.textContent).not.toContain('未命名设计')
  })

  it('loads the template into the editor rather than starting blank', async () => {
    await openLibrary()
    fireEvent.click(screen.getAllByText('打开')[0]!)
    await screen.findByLabelText('label canvas')

    // The template's single rect must be on the canvas.
    expect(document.querySelectorAll('[data-element-id]').length).toBe(1)
  })

  it('preselects the template in the top bar', async () => {
    await openLibrary()
    fireEvent.click(screen.getAllByText('打开')[0]!)
    const toolbar = await screen.findByRole('toolbar', { name: '标签设计' })
    const select = toolbar.querySelector('select')
    expect((select as HTMLSelectElement).value).toBe('tpl-1')
  })
})

describe('the unsaved marker', () => {
  it('is absent on a freshly opened template', async () => {
    await openLibrary()
    fireEvent.click(screen.getAllByText('打开')[0]!)
    await screen.findByLabelText('label canvas')
    expect(screen.queryAllByLabelText('有未保存的修改')).toHaveLength(0)
  })

  it('appears once something is edited', async () => {
    await openLibrary()
    fireEvent.click(screen.getAllByText('打开')[0]!)
    await screen.findByLabelText('label canvas')

    // Adding an element is an edit. Nothing set this flag before, so the
    // marker, the close confirmation and the leave prompt were all inert.
    fireEvent.click(screen.getAllByText('椭圆')[0]!)
    expect(await screen.findAllByLabelText('有未保存的修改')).not.toHaveLength(0)
  })
})
