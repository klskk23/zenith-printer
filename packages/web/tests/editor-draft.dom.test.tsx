/**
 * Leaving the editor and coming back loses nothing.
 *
 * The tab bar is still here (step 2 of three), so "leaving" is closing the
 * tab, reloading, or navigating — and every one of them used to discard the
 * edits. Now the editor writes a draft, and reopening the same label reads
 * it back with its undo history.
 *
 * The draft store under test is the application's real one. In happy-dom
 * there is no `localStorage`, so it is the in-memory kind and is cleared
 * between tests; the quota and no-storage cases inject a store of their own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { copy } from '../src/i18n/index.ts'
import { draftStore } from '../src/features/drafts/index.ts'
import { DraftsProvider } from '../src/features/drafts/use-draft.tsx'
import { createDraftStore } from '../src/features/drafts/store.ts'
import { failingStorage } from './drafts/support.ts'

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
  variables: [],
  dataSourceId: null,
  bindingIssue: null,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  version: 1,
}

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  draftStore.clear()
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/templates')) return json({ templates: [TEMPLATE] })
    return json({})
  }))
})

/** Open the saved template in a design tab and wait for its canvas. */
async function openTemplate(): Promise<void> {
  const tiles = await screen.findAllByRole('button', { name: /test/ })
  fireEvent.click(tiles[0]!)
  await screen.findByLabelText('label canvas')
}

/** Add a text element — the simplest edit that lands in the undo stack. */
function addText(): void {
  fireEvent.click(screen.getAllByText('文字')[0]!)
}

const textsOnCanvas = (): number => document.querySelectorAll('[data-label-canvas] svg text').length

/** Let the debounced write land. */
const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)))

describe('a saved label', () => {
  it('writes a draft with its history after an edit', async () => {
    render(wrap(<App />))
    await openTemplate()
    addText()
    await settle()
    const draft = draftStore.read('tpl-1')
    expect(draft).not.toBeNull()
    expect(draft && 'present' in draft ? draft.present.elements.length : 0).toBe(2)
    expect(draft && 'past' in draft ? draft.past.length : 0).toBeGreaterThanOrEqual(1)
  })

  it('comes back with the edit and the undo history after a remount', async () => {
    render(wrap(<App />))
    await openTemplate()
    addText()
    await settle()
    cleanup()

    window.history.replaceState(null, '', '/')
    render(wrap(<App />))
    await openTemplate()
    expect(textsOnCanvas()).toBe(1)
    const undoButton = screen.getByLabelText(copy.editor.undo) as HTMLButtonElement
    expect(undoButton.disabled).toBe(false)
  })

  it('flushes the draft when the sidebar is clicked, not only after the pause', async () => {
    render(wrap(<App />))
    await openTemplate()
    addText()
    // Straight to another page, inside the debounce window.
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    expect(document.querySelector('[data-label-canvas]')).toBeNull()
    expect(draftStore.read('tpl-1')).not.toBeNull()
  })
})

describe('a new label', () => {
  it('survives a reload at its own address', async () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText(copy.labels.new)[0]!)
    await screen.findByLabelText('label canvas')
    addText()
    await settle()
    const address = window.location.pathname
    expect(address).toMatch(/^\/labels\/new\/.+/)
    cleanup()

    // Same address, fresh mount: the reload case.
    render(wrap(<App />))
    await screen.findByLabelText('label canvas')
    expect(textsOnCanvas()).toBe(1)
  })
})

describe('when the draft cannot be kept', () => {
  it('says so when the browser has no storage to keep it in', async () => {
    const memory = createDraftStore(failingStorage(0), () => new Date().toISOString(), 'w')
    render(wrap(<DraftsProvider store={memory} persistence="memory"><App /></DraftsProvider>))
    await openTemplate()
    expect(screen.getAllByText(copy.drafts.noStorage.what).length).toBeGreaterThan(0)
  })

  it('says so when the write is refused, and stops saying so once it succeeds', async () => {
    const storage = failingStorage(99)
    const store = createDraftStore(storage, () => new Date().toISOString(), 'w')
    render(wrap(<DraftsProvider store={store} persistence="local"><App /></DraftsProvider>))
    await openTemplate()
    addText()
    await settle()
    expect(screen.getAllByText(copy.drafts.unpersisted.what).length).toBeGreaterThan(0)

    storage.failures = 0
    addText()
    await settle()
    expect(screen.queryByText(copy.drafts.unpersisted.what)).toBeNull()
  })
})
