/**
 * Linking a Google spreadsheet, from the browser.
 *
 * The step worth pinning is the confirmation: column names become reference
 * names, so somebody has to see them before they exist. A spreadsheet whose
 * header is not on the first row is obvious here and invisible everywhere else
 * until a label prints wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DataSourcesPage } from '../src/features/data-sources/data-sources-page.tsx'

let status: { configured: boolean; clientEmail: string | null }
let created: Array<Record<string, unknown>>
let previewReply: Record<string, unknown>

const WORKSHEETS = {
  spreadsheetId: 'sheet-1',
  spreadsheetTitle: '出货台账',
  worksheets: [
    { id: 0, title: '本月出货' },
    { id: 77, title: '存档' },
  ],
}

const PREVIEW = {
  spreadsheetTitle: '出货台账',
  worksheetTitle: '本月出货',
  columns: ['订单号', '收件人'],
  sampleRows: [
    { 订单号: 'A-001', 收件人: '张三' },
    { 订单号: '007', 收件人: '李四' },
  ],
  totalRows: 2,
  suggestedName: '本月出货',
  nameTaken: false,
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown, ok = true): Promise<Response> =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 422,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  status = { configured: true, clientEmail: 'zenith@example.iam.gserviceaccount.com' }
  created = []
  previewReply = PREVIEW

  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/google/status')) return json(status)
    if (url.includes('/google/worksheets')) return json(WORKSHEETS)
    if (url.includes('/google/preview')) return json(previewReply)
    if (url.includes('/data-sources/google')) {
      created.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json({ id: 'ds-1', name: '本月出货', columns: [], rowCount: 0, sourceKind: 'google-sheets' })
    }
    return json({ dataSources: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Wait for the status query before touching anything.
 *
 * The entry point is disabled until it lands — correctly, since nothing is
 * known yet — so a click before that goes nowhere and every later step fails
 * for a reason that has nothing to do with what is under test.
 */
async function ready(): Promise<void> {
  render(wrap(<DataSourcesPage />))
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '链接 Google 表格' }) as HTMLButtonElement).disabled,
    ).toBe(status.configured !== true),
  )
  // Configured: the address moved behind the title's mark, so the mark is the
  // page's evidence that Google is set up. Not configured: the page says so in
  // words, because there is nothing to put behind a mark.
  if (status.configured) {
    await waitFor(() => expect(document.querySelector('[data-value-hint]')).not.toBeNull())
  } else {
    await screen.findByText(/部署方/)
  }
}

/** Walk the dialog as far as the preview step. */
async function openToPreview(): Promise<void> {
  await ready()
  fireEvent.click(screen.getByRole('button', { name: '链接 Google 表格' }))
  fireEvent.change(screen.getByLabelText('表格链接'), {
    target: { value: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' },
  })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(await screen.findByText('本月出货'))
}

describe('the entry point', () => {
  it('is offered when a Google identity is configured', async () => {
    await ready()
    expect(
      (screen.getByRole('button', { name: '链接 Google 表格' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('says which address a spreadsheet must be shared with, one click away', async () => {
    // Still on the page rather than only inside a failure message — it is the
    // one thing somebody needs before they can use the feature at all — but
    // behind the title's mark, where it can be copied instead of read aloud.
    await ready()
    fireEvent.click(document.querySelector('[data-value-hint]') as HTMLElement)
    const value = await waitFor(() => {
      const node = document.querySelector('[data-hint-value]')
      expect(node).not.toBeNull()
      return node!
    })
    expect(value.textContent).toMatch(/zenith@example\.iam\.gserviceaccount\.com/)
  })

  it('is disabled, and says why, when none is configured', async () => {
    // Not hidden: somebody looking for the feature should learn that it exists
    // and what is missing, rather than conclude it was never built.
    status = { configured: false, clientEmail: null }
    await ready()
    expect(
      (screen.getByRole('button', { name: '链接 Google 表格' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/部署方/)).toBeDefined()
  })
})

describe('the three steps', () => {
  it('lists the worksheets in a pasted link', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '链接 Google 表格' }))
    fireEvent.change(screen.getByLabelText('表格链接'), {
      target: { value: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' },
    })
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    expect(await screen.findByText('本月出货')).toBeDefined()
    expect(screen.getByText('存档')).toBeDefined()
  })

  it('shows the columns and some rows before anything is created', async () => {
    await openToPreview()
    expect(await screen.findByText('订单号')).toBeDefined()
    expect(screen.getByText('A-001')).toBeDefined()
    // The leading zero is the point of the whole value-rendering decision.
    expect(screen.getByText('007')).toBeDefined()
    expect(created).toHaveLength(0)
  })

  it('fills the name box with the worksheet name', async () => {
    // Scoped to the dialog: the sequence-pool panel on the same page has a
    // field labelled the same way, and a document-wide query finds both.
    await openToPreview()
    await waitFor(() =>
      expect(
        (within(screen.getByRole('dialog')).getByLabelText('名称') as HTMLInputElement).value,
      ).toBe('本月出货'),
    )
  })

  it('creates only once confirmed, with the name that was shown', async () => {
    await openToPreview()
    await screen.findByText('订单号')
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({ spreadsheetId: 'sheet-1', worksheetId: 0, name: '本月出货' })
  })

  it('refuses to create under a name that is already taken', async () => {
    // Said here rather than after the fact: a clash should be a correction,
    // not a failed create.
    previewReply = { ...PREVIEW, nameTaken: true }
    await openToPreview()
    await screen.findByText('订单号')

    expect(
      (screen.getByRole('button', { name: '创建数据源' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/已被占用/)).toBeDefined()
  })
})
