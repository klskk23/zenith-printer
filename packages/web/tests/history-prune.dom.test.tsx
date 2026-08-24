/**
 * The history page: fetching ten instead of everything, and clearing the rest.
 *
 * The list used to arrive whole and be sliced in the browser. Every visit
 * therefore carried every job snapshot ever recorded — each one a full label IR
 * — to draw five rows. The page now asks for ten and asks the server how many
 * there are, which is why "show all 372" has to read its number from the
 * response rather than from the rows it happens to be holding.
 *
 * Pruning is the other half: without it the only way the list stops growing is
 * that nobody prints. It deletes records for everybody and cannot be undone, so
 * it is confirmed (III.0) — and nothing may leave the browser before that
 * confirmation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HistoryPage } from '../src/pages/history-page.tsx'
import { PreferencesProvider } from '../src/features/preferences/context.tsx'

const requested: string[] = []
const posted: Array<{ url: string; body: unknown }> = []

function job(id: string) {
  return {
    id,
    printerId: 'p1',
    status: 'completed',
    requestedCopies: 2,
    pagesPrinted: 2,
    failureCode: null,
    failureMessage: null,
    snapshot: { templateName: '面单', widthMm: 40, heightMm: 30, printerKind: 'niimbot' },
    createdAt: '2026-08-24T01:00:00.000Z',
    startedAt: '2026-08-24T01:00:00.000Z',
    finishedAt: '2026-08-24T01:00:05.000Z',
  }
}

/** Ten rows held, 372 on the server — the case the two numbers can disagree. */
const listBody: Record<string, unknown> = {
  jobs: Array.from({ length: 10 }, (_, i) => job(`job-${String(i)}`)),
  total: 372,
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
  requested.length = 0
  posted.length = 0
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const body = init?.method === 'POST'
      ? { deleted: 272, kept: 100 }
      : (requested.push(url), listBody)
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) })
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = (): void => { render(wrap(<HistoryPage />)) }
const listCalls = () => requested.filter((url) => url.includes('/print-jobs'))

describe('how much it fetches', () => {
  it('asks for ten, not for everything', async () => {
    open()
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0))
    expect(listCalls()[0]).toContain('limit=10')
  })

  it('asks only for jobs that are over', async () => {
    // Queued work belongs to the queue page. Without this the ten most recent
    // jobs could be ten queued ones and history would come back empty.
    open()
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0))
    expect(listCalls()[0]).toContain('finished=true')
  })

  it('counts from the server, not from the rows it is holding', async () => {
    open()
    // Ten rows in hand, 372 on the server: the offer has to name 372.
    expect(await screen.findByRole('button', { name: '查看全部 372 条' })).toBeDefined()
  })

  it('drops the limit when all of them are asked for', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: '查看全部 372 条' }))
    await waitFor(() => expect(listCalls().some((url) => !url.includes('limit='))).toBe(true))
  })
})

describe('clearing it out', () => {
  const pruneButton = () => screen.findByRole('button', { name: '清理…' })

  it('offers the action on the page', async () => {
    open()
    expect(await pruneButton()).toBeDefined()
  })

  it('sends nothing merely because the dialog was opened', async () => {
    // A "did you mean it?" that already meant it is worse than no dialog.
    open()
    fireEvent.click(await pruneButton())
    await screen.findByRole('button', { name: '清理' })
    expect(posted).toHaveLength(0)
  })

  it('says how many go and how many stay before anything is deleted', async () => {
    open()
    fireEvent.click(await pruneButton())
    // 372 recorded, 100 kept by default.
    expect(await screen.findByText(/将删除 272 条/)).toBeDefined()
  })

  it('says the numbering survives, because that is the thing worth fearing', async () => {
    open()
    fireEvent.click(await pruneButton())
    expect(await screen.findByText(/流水号/)).toBeDefined()
  })

  it('posts the number to keep once confirmed', async () => {
    open()
    fireEvent.click(await pruneButton())
    fireEvent.click(await screen.findByRole('button', { name: '清理' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]?.url).toContain('/print-jobs/prune')
    expect(posted[0]?.body).toEqual({ keep: 100 })
  })

  it('refreshes the list afterwards instead of showing what it just deleted', async () => {
    open()
    const before = listCalls().length
    fireEvent.click(await pruneButton())
    fireEvent.click(await screen.findByRole('button', { name: '清理' }))
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before))
  })
})
