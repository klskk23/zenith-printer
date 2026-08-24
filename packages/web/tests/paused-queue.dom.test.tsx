/**
 * A paused queue says why, and offers the way out.
 *
 * A failure pauses the printer's queue on purpose. The reason was recorded and
 * shown nowhere, and resuming lived on the printer page — so after a restart
 * the queue simply appeared broken: jobs sat there, nothing printed, and
 * nothing on screen said why or what to do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const PRINTER = {
  id: 'prn-1',
  name: 'B3S_P',
  kind: 'niimbot',
  transport: 'serial',
  address: '/dev/ttyACM0',
  capabilities: null,
  queueState: 'paused',
  queuePausedReason: 'JOB_INTERRUPTED_BY_RESTART',
  lastProbedAt: null,
  createdAt: '2026-08-21T00:00:00.000Z',
  offsetXDots: 0,
  offsetYDots: 0,
}

const JOB = {
  id: 'job-1',
  printerId: 'prn-1',
  status: 'failed',
  requestedCopies: 100,
  pagesPrinted: null,
  failureCode: 'JOB_INTERRUPTED_BY_RESTART',
  failureMessage: null,
  snapshot: { templateName: 'shipping', widthMm: 50, heightMm: 30 },
  createdAt: '2026-08-21T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

const calls: { url: string; method: string }[] = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(cleanup)

beforeEach(() => {
  calls.length = 0
  window.history.replaceState(null, '', '/')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })
      const body = url.includes('/print-jobs')
        ? { jobs: [JOB] }
        : url.includes('/printers')
          ? { printers: [PRINTER] }
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

async function openQueue(): Promise<void> {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('打印队列')[0]!)
  await screen.findAllByText(/打印队列已暂停/)
}

describe('the paused banner', () => {
  it('names the printer that is held', async () => {
    await openQueue()
    expect(screen.getAllByText(/B3S_P 的打印队列已暂停/).length).toBeGreaterThan(0)
  })

  it('explains the reason in words, not as a code', async () => {
    await openQueue()
    expect(screen.getAllByText(/因服务重启而中断/).length).toBeGreaterThan(0)
    expect(screen.queryByText('JOB_INTERRUPTED_BY_RESTART')).toBeNull()
  })

  it('offers the way out', async () => {
    await openQueue()
    expect(screen.getAllByText('恢复队列').length).toBeGreaterThan(0)
  })

  it('resumes when asked', async () => {
    await openQueue()
    fireEvent.click(screen.getAllByText('恢复队列')[0]!)
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/queue'))).toBe(true),
    )
  })
})

describe('reprinting a failed job', () => {
  it('offers the action', async () => {
    await openQueue()
    expect(screen.getAllByText('补打').length).toBeGreaterThan(0)
  })

  /** The count is unknowable after a restart, so it is asked for. */
  it('asks how many, rather than assuming the original count', async () => {
    await openQueue()
    fireEvent.click(screen.getAllByText('补打')[0]!)
    expect(await screen.findAllByText(/无法确认/)).not.toHaveLength(0)
  })

  it('submits the count the operator entered', async () => {
    await openQueue()
    fireEvent.click(screen.getAllByText('补打')[0]!)
    await screen.findAllByText(/无法确认/)

    const dialog = document.querySelector('[role="dialog"]')!
    const input = dialog.querySelector('input')!
    fireEvent.change(input, { target: { value: '37' } })
    // By the confirm button's exact wording. "the first button whose text
    // contains 打印" used to work and stopped when the dialog grew a printer
    // and a settings select — one of whose placeholders also contains it.
    fireEvent.click(
      [...dialog.querySelectorAll('button')].find((b) => /^打印 \d+ 张$/.test(b.textContent ?? ''))!,
    )

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/reprint'))).toBe(true),
    )
  })
})
