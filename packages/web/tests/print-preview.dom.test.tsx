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

let formFields: unknown[] = []
let designFields: never[] = []

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
  formFields = []
  designFields = []
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
    const body = url.includes('print-form') ? { fields: formFields } : { warnings: [] }
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
        fields={designFields}
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
  it('waits for the fields rather than previewing a label with holes in it', async () => {
    // The design decides which fields exist; the server only fills in where a
    // sequence has got to.
    designFields = [{ name: 'sku', label: 'SKU', source: 'manual' }] as never[]
    formFields = [{ name: 'sku', label: 'SKU', source: 'manual' }]
    open({ templateId: 'tpl-1' })

    expect(await screen.findByText('填完上面的变量后才能预览')).toBeDefined()
    expect(previews).toHaveLength(0)
  })

  it('previews once they are filled in', async () => {
    designFields = [{ name: 'sku', label: 'SKU', source: 'manual' }] as never[]
    formFields = [{ name: 'sku', label: 'SKU', source: 'manual' }]
    open({ templateId: 'tpl-1' })
    await screen.findByText('填完上面的变量后才能预览')

    const field = [...document.querySelectorAll('input')].find(
      (i) => i.type !== 'number',
    ) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'A-1' } })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { sku: 'A-1' } })
  })

  it('previews the first copy of a sequence, not the first number', async () => {
    // The suggestion continues from what has already been printed; showing
    // 0001 would be a label nobody is about to produce.
    designFields = [
      { name: 'serial', label: '流水号', source: 'sequence', seqStart: 1, seqDigits: 4 },
    ] as never[]
    formFields = [
      { name: 'serial', label: '流水号', source: 'sequence', suggestedStart: 41, seqDigits: 4, seqStep: 1 },
    ]
    open({ templateId: 'tpl-1' })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { serial: '0041' } })
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
   * The reported failure. An unsaved design has no template, so the print form
   * endpoint is never called — the dialog offered nothing to fill in, the
   * preview asked the server to resolve a `$var` it had no value for, and it
   * came back as "could not render" with no way to act on it.
   *
   * The fields live in the editor, and now they travel with the dialog.
   */
  it('still asks about its variable fields', async () => {
    designFields = [{ name: 'sku', label: 'SKU', source: 'manual' }] as never[]
    open({ templateId: null })

    expect(await screen.findByText('填完上面的变量后才能预览')).toBeDefined()
    expect([...document.querySelectorAll('label')].map((l) => l.textContent)).toContain('SKU')
  })

  it('previews once they are filled in', async () => {
    designFields = [{ name: 'sku', label: 'SKU', source: 'manual' }] as never[]
    open({ templateId: null })
    await screen.findByText('填完上面的变量后才能预览')

    const field = [...document.querySelectorAll('input')].find((i) => i.type !== 'number')!
    fireEvent.change(field, { target: { value: 'A-1' } })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { sku: 'A-1' } })
  })

  /**
   * A sequence claim is recorded against a template, because its purpose is to
   * carry on across print runs. Submitting one from an unsaved design produces
   * a job that fails in the queue — a wasted trip, and a poor place to find
   * out.
   */
  it('refuses to print a sequence until the template is saved', async () => {
    designFields = [
      { name: 'serial', label: '流水号', source: 'sequence', seqStart: 1, seqDigits: 4 },
    ] as never[]
    open({ templateId: null })

    expect(await screen.findByText(/序号字段需要先保存为模板/)).toBeDefined()
    expect((screen.getByRole('button', { name: '确认打印' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('allows a manual field without saving', async () => {
    designFields = [{ name: 'sku', label: 'SKU', source: 'manual' }] as never[]
    open({ templateId: null })
    expect(screen.queryByText(/序号字段需要先保存为模板/)).toBeNull()
  })
})

describe('a saved template', () => {
  it('takes the server’s sequence continuation, not the design’s start', async () => {
    // Where a sequence has got to lives in the claims. Starting over would
    // reprint numbers already on labels.
    designFields = [
      { name: 'serial', label: '流水号', source: 'sequence', seqStart: 1, seqDigits: 4 },
    ] as never[]
    formFields = [
      { name: 'serial', label: '流水号', source: 'sequence', suggestedStart: 741, seqDigits: 4, seqStep: 1 },
    ]
    open({ templateId: 'tpl-1' })

    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(previews[0]).toMatchObject({ variableValues: { serial: '0741' } })
  })
})
