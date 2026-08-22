/**
 * Importing and exporting from the library screen.
 *
 * The behaviour worth pinning: importing never refuses over a missing table,
 * it reports; and the report is shown in the server's words rather than
 * reworded here, so one situation never gets two descriptions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TemplatesPage } from '../src/pages/templates-page.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'

const TEMPLATE = {
  id: 'tpl-1', name: '面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: true,
}

const FILE = { kind: 'zenith.templates', formatVersion: 1, templates: [TEMPLATE] }

let importCalls: Array<Record<string, unknown>>
/** What POST /templates/import answers with next. */
let importReply: { status: number; body: unknown }
let downloaded: string[]

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve({
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  importCalls = []
  downloaded = []
  importReply = { status: 200, body: { imported: [{ id: 'tpl-1', name: '面单' }], warnings: [] } }

  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/templates/import')) {
      importCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json(importReply.body, importReply.status)
    }
    if (url.includes('/templates/export')) {
      return json(FILE)
    }
    if (url.includes('/data-sources')) {
      return json({ dataSources: [] })
    }
    return json({ templates: [TEMPLATE] })
  }))

  // happy-dom has no download machinery; record what was offered instead.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:x',
    revokeObjectURL: () => undefined,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded.push(this.download)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Hand the hidden picker a file, as choosing one in the dialog would. */
async function choose(contents: unknown): Promise<void> {
  const input = screen.getByLabelText('选择模板文件') as HTMLInputElement
  const file = new File([JSON.stringify(contents)], 'x.json', { type: 'application/json' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

describe('exporting', () => {
  it('offers a file for one design', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() => expect(downloaded).toEqual(['面单.json']))
  })

  it('offers a file for the whole library', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    await waitFor(() => expect(downloaded).toEqual(['zenith-templates.json']))
  })
})

describe('importing', () => {
  it('sends the file that was chosen', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await choose(FILE)
    await waitFor(() => expect(importCalls).toHaveLength(1))
    expect(importCalls[0]).toEqual({ file: FILE })
  })

  it('shows the server s wording for what did not resolve, not its own', async () => {
    // Rewording here would give one situation two descriptions, and the
    // command line prints these same sentences.
    importReply = {
      status: 200,
      body: {
        imported: [{ id: 'tpl-1', name: '面单' }],
        warnings: [
          {
            code: 'DATA_SOURCE_MISSING',
            templateName: '面单',
            detail: {},
            message: '本机没有它绑定的数据源「订单表」，需要这些列：订单号、收件人',
          },
        ],
      },
    }
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await choose(FILE)

    expect(await screen.findByText(/本机没有它绑定的数据源/)).toBeDefined()
  })

  it('says so when everything resolved, rather than staying silent', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await choose(FILE)
    expect(await screen.findByText('所有引用都对上了，没有需要处理的地方。')).toBeDefined()
  })

  it('asks before overwriting, and does not send a decision until one is made', async () => {
    importReply = {
      status: 409,
      body: {
        code: 'TEMPLATE_ALREADY_EXISTS',
        what: 'x', why: 'y', next: 'z',
        details: { templates: [{ id: 'tpl-1', name: '面单' }] },
      },
    }
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await choose(FILE)

    expect(await screen.findByText('文件里有本机已存在的模板')).toBeDefined()
    expect(importCalls[0]).toEqual({ file: FILE })
    expect(importCalls[0]).not.toHaveProperty('onConflict')
  })

  it('sends the choice once it is made', async () => {
    importReply = {
      status: 409,
      body: {
        code: 'TEMPLATE_ALREADY_EXISTS', what: 'x', why: 'y', next: 'z',
        details: { templates: [{ id: 'tpl-1', name: '面单' }] },
      },
    }
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await choose(FILE)
    await screen.findByText('文件里有本机已存在的模板')

    importReply = { status: 200, body: { imported: [], warnings: [] } }
    fireEvent.click(screen.getByRole('button', { name: '覆盖现有' }))
    await waitFor(() => expect(importCalls).toHaveLength(2))
    expect(importCalls[1]).toMatchObject({ onConflict: 'overwrite' })
  })
})
