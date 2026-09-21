/**
 * The close-tab confirmation tells the truth about drafts.
 *
 * It used to say "关闭后无法恢复", which was true. With drafts it is false,
 * and a confirmation that lies is worse than none: people learn to ignore
 * it, and then it cannot warn them about the one case that still matters.
 * Step 2 keeps the confirmation — the tab bar is the safety net drafts are
 * proving themselves under — but makes it say what happens.
 *
 * Removed with the tab bar in step 3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'
import { copy } from '../src/i18n/index.ts'
import { draftStore } from '../src/features/drafts/index.ts'

const TEMPLATE = {
  id: 'tpl-1', name: 'test', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', version: 1,
}

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  draftStore.clear()
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const body = String(input).includes('/templates') ? { templates: [TEMPLATE] } : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

async function openAndEdit(): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('模板库')[0]!)
  await screen.findAllByText('test')
  fireEvent.click(screen.getAllByText('打开')[0]!)
  await screen.findByLabelText('label canvas')
  fireEvent.click(screen.getAllByText('文字')[0]!)
}

function closeDesignTab(): void {
  // The design tab's own ×: the strip's first close button belongs to the
  // home tab, which has nothing to confirm.
  const strip = document.querySelector('[data-tab-bar]')!
  const designTab = [...strip.children].find((tab) => tab.textContent?.includes('test'))!
  const button = [...designTab.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === copy.workspace.close,
  )!
  fireEvent.click(button)
}

describe('closing a tab with unsaved edits', () => {
  it('still asks', async () => {
    await openAndEdit()
    closeDesignTab()
    expect(await screen.findByText(copy.workspace.confirmCloseTitle)).toBeDefined()
  })

  it('says the edits are kept as a draft, and no longer that they are lost', async () => {
    await openAndEdit()
    closeDesignTab()
    const body = await screen.findByText(copy.workspace.confirmCloseBody)
    expect(body.textContent).toContain('草稿')
    expect(body.textContent).not.toContain('无法恢复')
  })

  it('keeps the draft after the close is confirmed', async () => {
    await openAndEdit()
    closeDesignTab()
    fireEvent.click(await screen.findByText(copy.workspace.confirmCloseConfirm))
    expect(document.querySelector('[data-label-canvas]')).toBeNull()
    const draft = draftStore.read('tpl-1')
    expect(draft && 'present' in draft ? draft.present.elements.length : 0).toBe(1)
  })
})
