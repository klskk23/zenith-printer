import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TemplatesPage } from '../src/pages/templates-page.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'

/**
 * Renaming a template, and the line that says where it prints from.
 *
 * The card used to count "variable fields", a mechanism this feature removed —
 * so it counted something that no longer exists. What is worth knowing at a
 * glance now is which table the design draws its rows from.
 */
let templates: Array<Record<string, unknown>>
let dataSources: Array<Record<string, unknown>>
let patched: Array<{ url: string; body: unknown }>

const TEMPLATE = {
  id: 'tpl-1',
  name: '面单',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [],
  variables: [],
  dataSourceId: null,
  bindingIssue: null,
  createdAt: 'T',
  updatedAt: 'T',
  version: 1,
}

const SOURCE = { id: 'ds-1', name: '订单表', columns: ['订单号'], rowCount: 3, createdAt: 'T', updatedAt: 'T' }

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  templates = [{ ...TEMPLATE }]
  dataSources = [SOURCE]
  patched = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { name: string }
        patched.push({ url, body })
        templates = templates.map((template) => ({ ...template, name: body.name }))
        return json(templates[0])
      }
      return json(url.includes('/data-sources') ? { dataSources } : { templates })
    }),
  )
})

function json(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('renaming a template', () => {
  it('mounts and actually renders the library', async () => {
    expect(() => render(wrap(<TemplatesPage />))).not.toThrow()
    expect(await screen.findByText('面单')).toBeDefined()
  })

  it('offers a rename on every template', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(screen.getByRole('button', { name: '改名' })).toBeDefined()
  })

  it('opens a field carrying the current name, so a small edit is a small edit', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    expect((screen.getByLabelText('模板名称') as HTMLInputElement).value).toBe('面单')
  })

  it('sends the new name and nothing else', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '快递面单' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]?.url).toContain('/templates/tpl-1')
    // Only the name: sending the elements back would make renaming fail
    // whenever the design had been edited elsewhere.
    expect(patched[0]?.body).toEqual({ name: '快递面单' })
  })

  it('trims the name, so a stray space is not part of it', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '  面单 2  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]?.body).toEqual({ name: '面单 2' })
  })

  it('refuses to save a blank name rather than sending one', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '   ' } })

    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(patched).toHaveLength(0)
  })

  it('explains that renaming breaks nothing, because that is the question', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    expect(screen.getByText(/不会影响任何东西/)).toBeDefined()
  })
})

describe('what the card says about the data source', () => {
  it('does not count variable fields, which no longer exist', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(screen.queryByText(/可变字段/)).toBeNull()
  })

  it('says so when nothing is bound', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-bound-source]')?.textContent).toBe('未绑定数据源')
  })

  it('names the bound table', async () => {
    templates = [{ ...TEMPLATE, dataSourceId: 'ds-1' }]
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-bound-source]')?.textContent).toBe('数据源：订单表'),
    )
  })

  it('shows the table s current name, not the one it was bound under', async () => {
    // The binding is by id, so a renamed table has to read as renamed here —
    // otherwise this line becomes a second, stale copy of the name.
    templates = [{ ...TEMPLATE, dataSourceId: 'ds-1' }]
    dataSources = [{ ...SOURCE, name: '订单表（八月）' }]
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-bound-source]')?.textContent).toBe('数据源：订单表（八月）'),
    )
  })
})
