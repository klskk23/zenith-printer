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
  hasThumbnail: true,
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

describe('the card thumbnail', () => {
  it('shows the picture that was drawn when the design was saved', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    const image = document.querySelector('[data-thumbnail]') as HTMLImageElement | null
    expect(image).not.toBeNull()
    expect(image!.getAttribute('src')).toBe('/api/templates/tpl-1/thumbnail?v=1')
  })

  it('keys the picture by version, so a saved change is not served from cache', async () => {
    templates = [{ ...TEMPLATE, version: 7 }]
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-thumbnail]')!.getAttribute('src')).toContain('v=7')
  })

  it('loads lazily, since a long library is mostly off-screen', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-thumbnail]')!.getAttribute('loading')).toBe('lazy')
  })

  it('says why there is none, in the room a frame this size has', async () => {
    // The design saved; it just could not be drawn. There is no space for a
    // sentence beside the title, so the frame carries it as a tooltip.
    templates = [{ ...TEMPLATE, hasThumbnail: false }]
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-thumbnail]')).toBeNull()
    expect(document.querySelector('[data-thumbnail-frame]')?.getAttribute('title')).toBe(
      '这个设计画不出预览图',
    )
  })

  it('sits beside the title rather than above the details', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    const frame = document.querySelector('[data-thumbnail-frame]')
    const title = screen.getByText('面单')
    // Same row: the frame and the title share a parent, and the frame is not
    // inside the block that carries the name and the size.
    expect(frame!.parentElement!.contains(title)).toBe(true)
    expect(frame!.contains(title)).toBe(false)
  })

  it('takes the label shape, so a glance says which way round the design is', async () => {
    templates = [
      { ...TEMPLATE, id: 'wide', name: '横的', widthMm: 100, heightMm: 20 },
      { ...TEMPLATE, id: 'tall', name: '竖的', widthMm: 20, heightMm: 100 },
    ]
    render(wrap(<TemplatesPage />))
    await screen.findByText('横的')

    const [wide, tall] = [...document.querySelectorAll('[data-thumbnail-frame]')] as HTMLElement[]
    const size = (el: HTMLElement): { w: number; h: number } => ({
      w: Number.parseFloat(el.style.width),
      h: Number.parseFloat(el.style.height),
    })
    expect(size(wide!).w).toBeGreaterThan(size(wide!).h)
    expect(size(tall!).h).toBeGreaterThan(size(tall!).w)
  })

  it('fixes the frame size before the image arrives, so cards do not jump', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    const frame = document.querySelector('[data-thumbnail-frame]') as HTMLElement
    expect(frame.style.width).not.toBe('')
    expect(frame.style.height).not.toBe('')
  })
})

describe('what the card says about the label', () => {
  it('gives the size in millimetres, which is what the design is', async () => {
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    expect(document.querySelector('[data-label-size]')?.textContent).toBe('50 × 30 mm')
  })

  it('does not claim a resolution or a printer kind, neither of which constrains it', async () => {
    // Both used to be printed here as though they said where the design could
    // go. The dot grid comes from whichever printer it is sent to, and both
    // drivers take a bitmap — showing them is what led people to re-save a
    // design that was never wrong.
    render(wrap(<TemplatesPage />))
    await screen.findByText('面单')
    const line = document.querySelector('[data-label-size]')?.textContent ?? ''
    expect(line).not.toContain('dpi')
    expect(line).not.toContain('niimbot')
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
