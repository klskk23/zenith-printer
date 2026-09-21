/**
 * "Nothing here yet" must mean nothing is here, not that nothing has arrived.
 *
 * The home page reads its lists as `(query.data ?? []).slice(...)`, and a query
 * that has not answered yet has no data — so the fallback is an empty array,
 * whose length is zero, which is the same test the empty state uses. Every
 * visit therefore opened by telling the operator they had saved no templates
 * and printed nothing, and then replaced it a moment later with their templates
 * and their history.
 *
 * A stale claim like that is worse than a blank: blank reads as "loading", and
 * "还没有保存的模板" reads as an answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LabelsPage } from '../src/pages/labels-page.tsx'
import { copy } from '../src/i18n/index.ts'
import { WorkspaceProvider } from '../src/app/workspace.tsx'

const TEMPLATE = {
  id: 'tpl-1', name: '面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [], variables: [], dataSourceId: null, createdAt: 'T', updatedAt: 'T',
  version: 1, bindingIssue: null, hasThumbnail: false,
}

/** Resolve each request only when the test says so. */
let release: () => void
let pending: Promise<void>

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  pending = new Promise<void>((resolve) => {
    release = resolve
  })
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    await pending
    const body = url.includes('/templates') ? { templates: [TEMPLATE] }
      : url.includes('/printers') ? { printers: [] }
      : url.includes('/print-jobs') ? { jobs: [], total: 0 }
      : {}
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('while the lists are still coming', () => {
  it('does not claim there are no saved templates', async () => {
    render(wrap(<LabelsPage />))
    expect(screen.queryByText(copy.labels.empty)).toBeNull()
  })

  it('does not claim there is no print history', async () => {
    render(wrap(<LabelsPage />))
    expect(screen.queryByText(copy.status.noPrints)).toBeNull()
  })

  it('shows placeholders instead, so the page keeps its shape', async () => {
    // Not a spinner and not blank: the sections are about to be filled, and
    // reserving their space stops the page jumping under the pointer.
    render(wrap(<LabelsPage />))
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})

describe('once they arrive', () => {
  it('shows what did arrive', async () => {
    render(wrap(<LabelsPage />))
    release()
    expect(await screen.findByText('面单')).toBeDefined()
  })

  it('puts the placeholders away', async () => {
    render(wrap(<LabelsPage />))
    release()
    await screen.findByText('面单')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0))
  })
})
