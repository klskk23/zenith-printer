/**
 * Sweeping unreferenced images from the settings page.
 *
 * Two things this guards, and they pull against each other:
 *
 *   - **One click, then confirm.** There is no "check first, then delete"
 *     round trip: an image nothing references and that is past the grace
 *     period can never be reached again from anywhere in the product, so a
 *     report would only be a screen to click past. What stays is the
 *     confirmation itself — deleting files is not undoable, and the
 *     constitution requires an explicit one.
 *   - **Nothing happens until it is confirmed.** Opening the dialog must not
 *     send anything; a "did you mean it?" that already meant it is worse than
 *     no dialog at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../src/pages/settings-page.tsx'
import { PreferencesProvider } from '../src/features/preferences/context.tsx'

const posted: Array<{ url: string; body: unknown }> = []
let response: Record<string, unknown> = {
  outcome: 'removed',
  removed: 7,
  strayFilesRemoved: 0,
  candidates: [],
  strayFiles: 0,
  keptReferenced: 3,
  keptTooNew: 2,
  bytesFreed: 52_428,
  minAgeHours: 24,
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return (
    <QueryClientProvider client={client}>
      <PreferencesProvider>{node}</PreferencesProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  posted.length = 0
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url: String(input), body: JSON.parse(String(init.body)) })
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    } as unknown as Response)
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openPage = (): void => { render(wrap(<SettingsPage />)) }
const pruneButton = (): HTMLElement => screen.getByRole('button', { name: '清理未引用的图片' })

describe('the maintenance card', () => {
  it('is on the page', () => {
    openPage()
    expect(pruneButton()).toBeDefined()
  })

  it('says it acts on the server, not on this browser', () => {
    // The page opens by saying its settings only affect this browser. A button
    // that deletes files for everybody sitting under that sentence, unmarked,
    // would make the sentence a lie.
    openPage()
    expect(screen.getByText(/对所有人生效/)).toBeDefined()
  })
})

describe('clicking it', () => {
  it('asks before doing anything', () => {
    openPage()
    fireEvent.click(pruneButton())
    expect(screen.getByText(/无法撤销/)).toBeDefined()
    expect(posted).toEqual([])
  })

  it('sends nothing at all when the dialog is dismissed', async () => {
    // Asserted through a later real run rather than straight after the click.
    // `mutate()` reaches fetch on a microtask, so checking synchronously finds
    // an empty list whether or not dismissing fired one — the first version of
    // this test passed with Cancel wired directly to the deletion.
    openPage()
    fireEvent.click(pruneButton())
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.click(pruneButton())
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await screen.findByText(/已删除/)

    expect(posted).toHaveLength(1)
  })

  it('deletes in one request once confirmed, with no report round trip', async () => {
    openPage()
    fireEvent.click(pruneButton())
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.url).toContain('/api/images/prune')
    expect(posted[0]!.body).toEqual({ confirm: true })
  })

  it('reports how many went and how much came back', async () => {
    openPage()
    fireEvent.click(pruneButton())
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByText(/已删除 7 张/)).toBeDefined()
  })

  it('says so when there was nothing to remove', async () => {
    response = { ...response, removed: 0, bytesFreed: 0, candidates: [] }
    openPage()
    fireEvent.click(pruneButton())
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByText(/没有可清理/)).toBeDefined()
  })
})
