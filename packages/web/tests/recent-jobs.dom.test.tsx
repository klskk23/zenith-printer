/**
 * The home page's recent-print list.
 *
 * It was a `<ul>` carrying its own `divide-y`, its own border and its own row
 * padding — a list built by hand next to a design system that has one. This
 * checks the part that survives the swap: it is still a list of rows, the rows
 * still say what printed and how it went, and a failed one can still be sent
 * again.
 *
 * The separators are asserted as *between* rows rather than after each,
 * because a trailing rule inside a bordered box draws a line above nothing —
 * the kind of thing that reads as a missing row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IndexPage } from '../src/pages/index-page.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'

const job = (id: string, status: string, name: string) => ({
  id,
  idempotencyKey: id,
  printerId: 'prn-1',
  templateId: 'tpl-1',
  profileId: null,
  requestedCopies: 2,
  pagesPrinted: 2,
  seqClaims: [],
  status,
  failureCode: null,
  failureMessage: null,
  snapshot: { templateName: name, ir: null, rows: [] },
  createdAt: '2026-09-03T10:00:00.000Z',
  startedAt: null,
  finishedAt: '2026-09-03T10:00:05.000Z',
})

let jobs: Array<Record<string, unknown>>

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
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
  jobs = [job('j1', 'completed', '货架标签'), job('j2', 'failed', '出货面单'), job('j3', 'completed', '资产标签')]
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    if (url.includes('/print-jobs')) return json({ jobs, total: jobs.length })
    if (url.includes('/printers')) return json({ printers: [] })
    if (url.includes('/templates')) return json({ templates: [] })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const list = async (): Promise<HTMLElement> => {
  render(wrap(<IndexPage />))
  const found = await screen.findAllByRole('list')
  const jobList = found.find((node) => within(node).queryByText(/货架标签/) !== null)
  expect(jobList, 'the recent-print list was not found').toBeDefined()
  return jobList!
}

describe('the recent prints', () => {
  it('are a list, one row per job', async () => {
    const rows = within(await list()).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
  })

  it('say what printed and how it went', async () => {
    const rows = within(await list()).getAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('货架标签')
    expect(rows[0]!.textContent).toContain('已完成')
  })

  it('rule between the rows, not after the last one', async () => {
    // A trailing rule inside a bordered box draws a line above nothing, which
    // reads as a row that failed to render.
    const separators = (await list()).querySelectorAll('[data-slot="item-separator"]')
    expect(separators).toHaveLength(2)
  })

  it('offer to send a failed one again', async () => {
    const rows = within(await list()).getAllByRole('listitem')
    const failed = rows.find((row) => row.textContent?.includes('出货面单'))!
    expect(within(failed).getByRole('button', { name: '重新提交' })).toBeDefined()
  })

  it('leave a finished one alone', async () => {
    // Nothing went wrong with it; offering to reprint from here would put a
    // button on every row for the sake of the one that needs it.
    const rows = within(await list()).getAllByRole('listitem')
    const done = rows.find((row) => row.textContent?.includes('货架标签'))!
    expect(within(done).queryByRole('button')).toBeNull()
  })
})
