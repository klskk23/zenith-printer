/**
 * What each of the two lists is for.
 *
 * The queue used to show every job it had ever seen, so it never emptied and
 * both pages showed the same rows. Each row carried a status and eight
 * characters of an id — which answers neither question actually asked of them:
 * when was this printed, and what was printed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
  createdAt: '2026-08-21T00:00:00.000Z', offsetXDots: 0, offsetYDots: 0,
}

const base = {
  printerId: 'prn-1',
  requestedCopies: 10,
  failureCode: null,
  failureMessage: null,
  createdAt: '2026-08-21T09:00:00.000Z',
  startedAt: '2026-08-21T10:00:00.000Z',
  finishedAt: '2026-08-21T11:00:00.000Z',
}

const JOBS = [
  { ...base, id: 'j-queued', status: 'queued', pagesPrinted: 0, finishedAt: null, startedAt: null,
    snapshot: { templateName: '运输标签', widthMm: 50, heightMm: 30 } },
  { ...base, id: 'j-done', status: 'completed', pagesPrinted: 10,
    snapshot: { templateName: '资产编号', widthMm: 40, heightMm: 20 } },
  { ...base, id: 'j-adhoc', status: 'completed', pagesPrinted: 3,
    snapshot: { templateName: null, widthMm: 50, heightMm: 30 } },
]

const FINISHED = new Set(['completed', 'failed', 'cancelled'])

/**
 * The fake answers the query the way the server does.
 *
 * History narrows to finished jobs on the server now, rather than fetching
 * everything and filtering in the browser. A stub that ignored the query would
 * let "history does not show what is still queued" pass while the page asked
 * for the wrong thing — the assertion would be about the stub, not the page.
 */
function jobsFor(url: string): { jobs: typeof JOBS; total: number } {
  const query = new URL(url, 'http://test').searchParams
  const matching = query.get('finished') === 'true' ? JOBS.filter((job) => FINISHED.has(job.status)) : JOBS
  const limit = query.get('limit')
  return {
    // `total` ignores the limit: it is how many there are, not how many were sent.
    total: matching.length,
    jobs: limit === null ? matching : matching.slice(-Number(limit)),
  }
}

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    const body = url.includes('/print-jobs') ? jobsFor(url)
      : url.includes('/printers') ? { printers: [PRINTER] }
      : url.includes('/templates') ? { templates: [] }
      : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

async function open(tab: string): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText(tab)[0]!)
  await screen.findAllByText(tab)
}

describe('the queue', () => {
  it('shows what is in flight', async () => {
    await open('打印队列')
    expect(await screen.findAllByText('运输标签')).not.toHaveLength(0)
  })

  /** Finished work belongs to history; a queue that never empties says nothing. */
  it('does not keep finished jobs', async () => {
    await open('打印队列')
    await screen.findAllByText('运输标签')
    expect(screen.queryByText('资产编号')).toBeNull()
  })

  it('shows when, not an id fragment', async () => {
    await open('打印队列')
    await screen.findAllByText('运输标签')
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
    expect(screen.queryByText('j-queued'.slice(0, 8))).toBeNull()
  })

  it('shows the number of labels', async () => {
    await open('打印队列')
    await screen.findAllByText('运输标签')
    expect(screen.getAllByText(/10 张/).length).toBeGreaterThan(0)
  })

  it('has one heading, not two', async () => {
    await open('打印队列')
    await screen.findAllByText('运输标签')
    const headings = [...document.querySelectorAll('h2, h3')].map((h) => h.textContent)
    expect(headings.filter((h) => h === '打印队列')).toHaveLength(1)
  })
})

describe('history', () => {
  it('shows finished jobs', async () => {
    await open('打印历史')
    expect(await screen.findAllByText('资产编号')).not.toHaveLength(0)
  })

  it('does not show what is still queued', async () => {
    await open('打印历史')
    await screen.findAllByText('资产编号')
    expect(screen.queryByText('运输标签')).toBeNull()
  })

  /**
   * A one-off design has no template, and the absence is stated: a blank where
   * a name goes reads as missing data rather than as "there was never one".
   */
  it('says so when no template was used', async () => {
    await open('打印历史')
    await screen.findAllByText('资产编号')
    expect(screen.getAllByText(/未使用模板/).length).toBeGreaterThan(0)
  })

  it('shows when it printed', async () => {
    await open('打印历史')
    await screen.findAllByText('资产编号')
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0)
  })

  it('has one heading, not two', async () => {
    await open('打印历史')
    await screen.findAllByText('资产编号')
    const headings = [...document.querySelectorAll('h2, h3')].map((h) => h.textContent)
    expect(headings.filter((h) => h === '打印历史')).toHaveLength(1)
  })
})
