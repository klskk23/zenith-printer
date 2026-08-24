/**
 * Reprinting a job that went fine.
 *
 * The action was offered only on failures, because it grew out of "count the
 * labels and reprint the shortfall". But the commonest reason to reprint is
 * duller than that: the same batch is needed again next week.
 *
 * Which makes the default count the thing to get right. A completed job has no
 * shortfall — `requested - printed` is zero — so the failure-shaped default
 * would offer to print one label when the batch was a hundred.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JobHistory } from '../src/features/jobs/history.tsx'
import { PreferencesProvider } from '../src/features/preferences/context.tsx'

const jobs = [
  {
    id: 'job-done', printerId: 'prn-1', status: 'completed', requestedCopies: 100,
    pagesPrinted: 100, failureCode: null, failureMessage: null,
    snapshot: { templateName: '出货面单', widthMm: 40, heightMm: 30, printerKind: 'niimbot' },
    createdAt: '2026-08-24T00:00:00Z', startedAt: null, finishedAt: '2026-08-24T00:01:00Z',
  },
  {
    id: 'job-failed', printerId: 'prn-1', status: 'failed', requestedCopies: 100,
    pagesPrinted: 60, failureCode: 'DEVICE_ERROR', failureMessage: null,
    snapshot: { templateName: '出货面单', widthMm: 40, heightMm: 30, printerKind: 'niimbot' },
    createdAt: '2026-08-24T00:00:00Z', startedAt: null, finishedAt: '2026-08-24T00:01:00Z',
  },
]

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <PreferencesProvider>{node}</PreferencesProvider>
    </QueryClientProvider>
  )
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/profiles')) return json({ profiles: [] })
    if (url.includes('/printers')) return json({ printers: [] })
    return json({ jobs })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const rowFor = async (name: string): Promise<HTMLElement> => {
  await screen.findAllByText('出货面单')
  const row = [...document.querySelectorAll<HTMLElement>('[data-history-row]')].find((r) =>
    r.getAttribute('data-history-row') === name,
  )
  expect(row, `history row ${name} not found`).toBeDefined()
  return row!
}

describe('the action', () => {
  it('is offered on a job that finished', async () => {
    render(wrap(<JobHistory printerId={null} />))
    const row = await rowFor('job-done')
    expect(within(row).getByRole('button', { name: /重新打印|补打/ })).toBeDefined()
  })

  it('is still offered on a job that failed', async () => {
    render(wrap(<JobHistory printerId={null} />))
    const row = await rowFor('job-failed')
    expect(within(row).getByRole('button', { name: /重新打印|补打/ })).toBeDefined()
  })
})

describe('how many it offers to print', () => {
  it('offers the whole batch again for a job that finished', async () => {
    // Not the shortfall, which is zero here and would round up to one label.
    render(wrap(<JobHistory printerId={null} />))
    fireEvent.click(within(await rowFor('job-done')).getByRole('button', { name: /重新打印|补打/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('spinbutton')).toHaveProperty('value', '100')
  })

  it('offers the shortfall for a job that failed part-way', async () => {
    render(wrap(<JobHistory printerId={null} />))
    fireEvent.click(within(await rowFor('job-failed')).getByRole('button', { name: /重新打印|补打/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('spinbutton')).toHaveProperty('value', '40')
  })
})
