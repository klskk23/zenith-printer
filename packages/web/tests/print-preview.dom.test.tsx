/**
 * The preview, in the dialog that decides whether to burn a hundred labels.
 *
 * The component existed and nothing referenced it — so the one place that
 * shows what the printer will actually put down was unreachable, while the
 * settings that decide it (the cut-off, the image tone) grew controls of their
 * own. A setting you cannot see the effect of is a setting you tune blind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'
import { labelIrSchema } from '@zenith/shared'

const previews: Array<Record<string, unknown>> = []
const submitted: Array<Record<string, unknown>> = []

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTER = {
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
  lastProbedAt: '2026-08-22T00:00:00.000Z', createdAt: '2026-08-22T00:00:00.000Z',
  offsetXDots: 0, offsetYDots: 0,
}

const IR = labelIrSchema.parse({
  widthMm: 50, heightMm: 30, dpi: 203,
  elements: [{ id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }],
})

let variableValues: Record<string, string> = {}
let unresolved: string[] = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  previews.length = 0
  submitted.length = 0
  variableValues = {}
  unresolved = []
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:preview',
    revokeObjectURL: () => undefined,
  })
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/preview')) {
      previews.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'image/png', 'X-Clipped': 'false' }),
        blob: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/png' })),
      } as unknown as Response)
    }
    if (url.endsWith('/api/print-jobs') && init?.method === 'POST') {
      submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Promise.resolve({
        ok: true, status: 202,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ jobId: 'job-1', status: 'queued' }),
      } as unknown as Response)
    }
    const body = { warnings: [] }
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

function open(over: Partial<React.ComponentProps<typeof PrintDialog>> = {}): void {
  render(
    wrap(
      <PrintDialog
        ir={IR}
        templateId={null}
        profileId="pro-1"
        printer={PRINTER as never}
        variableValues={variableValues}
        unresolved={unresolved}
        onClose={() => undefined}
        {...over}
      />,
    ),
  )
}

describe('the print dialog', () => {
  it('shows a preview', async () => {
    open()
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(await screen.findByAltText('打印预览')).toBeDefined()
  })

  /**
   * Without the profile the preview would use the defaults, and show a label
   * the cut-off and the image tone were never applied to.
   */
  it('renders through the chosen profile', async () => {
    open()
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ printerId: 'prn-1', profileId: 'pro-1' })
  })

  /**
   * It renders the design on screen, edits included — which is what a preview
   * is for. It used to render the saved template, on the grounds that a job
   * with a `templateId` prints the stored version; true, and it meant that
   * after opening a template you had to save before you could see anything
   * you had just changed.
   */
  it('renders what is on screen, not the stored template', async () => {
    open({ templateId: 'tpl-1' })
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).not.toHaveProperty('templateId')
    expect(previews[0]).toHaveProperty('ir')
  })
})

describe('a batch of more than one', () => {
  it('says which label is being shown', async () => {
    open()
    const copies = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(copies, { target: { value: '20' } })
    expect(await screen.findByText(/共 20 张，此处预览第 1 张/)).toBeDefined()
  })

  it('says nothing about it for a single label', async () => {
    open()
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(screen.queryByText(/此处预览第 1 张/)).toBeNull()
  })
})

describe('a design with variables', () => {
  it('previews with the values the design resolves to', async () => {
    // The values come from the editor, not from a form: nothing is typed in
    // before printing any more.
    variableValues = { sku: 'A-1' }
    open({ templateId: 'tpl-1' })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { sku: 'A-1' } })
  })

  it('previews the number the next label will carry, not the first one', async () => {
    // Showing 0001 would be a label nobody is about to produce.
    variableValues = { serial: '0041' }
    open({ templateId: 'tpl-1' })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { serial: '0041' } })
  })

  it('refuses to print, and to preview, while a reference resolves to nothing', async () => {
    // The label would come out reading "${sku}", which is waste that looks
    // like output.
    unresolved = ['sku']
    open({ templateId: 'tpl-1' })

    expect(await screen.findByText(/引用了未定义的名称/)).toBeDefined()
    expect((screen.getByRole('button', { name: '确认打印' }) as HTMLButtonElement).disabled).toBe(true)
    expect(previews).toHaveLength(0)
  })
})

describe('the retired print form', () => {
  /**
   * The dialog used to collect values before printing. Nothing is typed in any
   * more — constants are fixed in the design, serials come from a pool, column
   * values come from the selected rows — so the form must not reappear.
   *
   * A negative assertion, because the failure mode is a *return*: the form is
   * easy to reintroduce by accident while adding the row-selection panel.
   */
  it('does not render a value form', async () => {
    variableValues = { sku: 'A-1' }
    open({ templateId: 'tpl-1' })
    await vi.waitFor(() => expect(previews).toHaveLength(1))

    expect(screen.queryByText('填完上面的变量后才能预览')).toBeNull()
    expect(screen.queryByText(/序号字段需要先保存为模板/)).toBeNull()
    // The only number input left is the copy count.
    const numbers = [...document.querySelectorAll('input')].filter((i) => i.type === 'number')
    expect(numbers).toHaveLength(1)
  })

  it('never calls the print-form endpoint, which no longer exists', async () => {
    variableValues = {}
    open({ templateId: 'tpl-1' })
    await vi.waitFor(() => expect(previews).toHaveLength(1))

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls.map((call) => String(call[0])).some((url) => url.includes('print-form'))).toBe(false)
  })
})

describe('the dialog itself', () => {
  /**
   * The printer is chosen on the editor's toolbar, and the print button there
   * is disabled until it is. Offering the choice again here asked a question
   * that had already been answered, in a dialog whose whole job is to confirm.
   */
  it('does not ask which printer again', () => {
    open()
    expect(document.querySelector('select')).toBeNull()
  })

  it('says which machine this is going to', () => {
    open()
    expect(screen.getByText('B3S_P')).toBeDefined()
  })

  it('is a real dialog, so focus and Escape behave', () => {
    // Hand-rolled overlays bring none of that, and do not stack with the
    // confirmations that open on top of them.
    open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})


describe('a template with unsaved edits', () => {
  /**
   * The design on screen goes with the job, so what was previewed is what
   * prints. `templateId` and `ir` used to be mutually exclusive, which meant
   * the id went alone and the *previous* version came out — the surprise that
   * made a live preview impossible to offer honestly.
   */
  it('submits the design on screen', async () => {
    open({ templateId: 'tpl-1' })
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '确认打印' }))

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toHaveProperty('ir')
  })

  it('still says which template it came from', async () => {
    // History has to keep the link, and the sequence fields are claimed from
    // the template.
    open({ templateId: 'tpl-1' })
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '确认打印' }))

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatchObject({ templateId: 'tpl-1' })
  })

  it('sends no template id for a design that was never one', async () => {
    open({ templateId: null })
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '确认打印' }))

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).not.toHaveProperty('templateId')
  })
})


describe('a design that was never saved', () => {
  /**
   * The reported failure, and why sequences no longer need a template: a pool
   * exists in its own right, so an unsaved design can draw from one. The old
   * model recorded claims against a template, which made this fail in the
   * queue — a wasted trip, and a poor place to find out (FR-007).
   */
  it('prints a sequence without being saved first', async () => {
    variableValues = { serial: '0041' }
    open({ templateId: null })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect((screen.getByRole('button', { name: '确认打印' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the design itself, since there is no template to name', async () => {
    variableValues = {}
    open({ templateId: null })
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '确认打印' }))

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toHaveProperty('ir')
    expect(submitted[0]).not.toHaveProperty('templateId')
  })
})
