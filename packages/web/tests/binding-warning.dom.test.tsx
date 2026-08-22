import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TemplatesPage } from '../src/pages/templates-page.tsx'
import { WorkspaceProvider } from '../src/app/workspace.tsx'
import { DataSourceBinding } from '../src/editor/data-source-binding.tsx'

/**
 * The warning a design carries when its data source is gone or its columns are.
 *
 * Deleting a table is allowed precisely because this exists: the design is
 * recoverable by rebinding, so a warning is the right response rather than
 * blocking the delete (FR-028, FR-028a).
 */
let templates: Array<Record<string, unknown>>

const base = {
  id: 'tpl-1',
  name: '面单',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [],
  variables: [],
  dataSourceId: 'ds-1',
  createdAt: 'T',
  updatedAt: 'T',
  version: 1,
}

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{node}</WorkspaceProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  templates = [{ ...base, bindingIssue: null }]
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/data-sources') ? { dataSources: [] } : { templates }
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the templates list', () => {
  it('says nothing when the binding is sound', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-binding-issue]')).toBeNull()
  })

  it('marks a design whose data source has been deleted', async () => {
    templates = [{ ...base, bindingIssue: { kind: 'sourceMissing' } }]
    render(wrap(<TemplatesPage />))
    expect(await screen.findByText(/所绑的数据源已被删除/)).toBeDefined()
  })

  it('marks a design whose column has gone, and names the column', async () => {
    templates = [{ ...base, bindingIssue: { kind: 'columnsMissing', columns: ['收件人'] } }]
    render(wrap(<TemplatesPage />))
    expect(await screen.findByText(/收件人/)).toBeDefined()
  })
})

describe('the design properties panel', () => {
  it('shows the same warning where the binding is changed', async () => {
    // The warning is only useful next to the control that fixes it.
    render(
      wrap(
        <DataSourceBinding
          dataSourceId="ds-1"
          onChange={() => undefined}
          bindingIssue={{ kind: 'sourceMissing' }}
        />,
      ),
    )
    expect(await screen.findByText(/所绑的数据源已被删除/)).toBeDefined()
    expect(screen.getByText(/重新选择一张同形状的表/)).toBeDefined()
  })

  it('says nothing when there is no issue', () => {
    render(wrap(<DataSourceBinding dataSourceId={null} onChange={() => undefined} bindingIssue={null} />))
    expect(document.querySelector('[data-binding-issue]')).toBeNull()
  })
})

describe('inserting a column reference', () => {
  /**
   * The column buttons were wired to a callback nobody passed, so clicking one
   * did nothing — the "written but never wired" shape, and invisible from the
   * outside because the button still highlighted.
   */
  it('hands back the reference for the column that was clicked', async () => {
    const inserted: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            Promise.resolve({
              dataSources: [
                { id: 'ds-1', name: '订单表', columns: ['订单号', '收件人'], rowCount: 1, createdAt: 'T', updatedAt: 'T' },
              ],
            }),
        } as unknown as Response),
      ),
    )

    render(
      wrap(
        <DataSourceBinding
          dataSourceId="ds-1"
          onChange={() => undefined}
          onInsertReference={(reference) => inserted.push(reference)}
        />,
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: '收件人' }))
    expect(inserted).toEqual(['${收件人}'])
  })
})
