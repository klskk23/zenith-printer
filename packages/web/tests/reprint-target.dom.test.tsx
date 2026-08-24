/**
 * Choosing where a reprint goes, and how dark.
 *
 * Reprinting used to be locked to the machine and the settings of the original
 * run, which covers only one of the two reasons anybody reprints. The other —
 * "that came out too light", "that one jammed, use the other machine" — had
 * nowhere to be expressed.
 *
 * Both default to the original, because a plain "print that again" must keep
 * meaning exactly that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReprintDialog } from '../src/features/jobs/reprint-dialog.tsx'
import type { PrintJob } from '../src/features/jobs/hooks.ts'
import { chooseOption, selectedText } from './support/select.ts'

const posted: Array<{ url: string; body: Record<string, unknown> }> = []

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const PRINTERS = [
  { id: 'prn-1', name: '前台 B3S', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
    capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
    offsetXDots: 0, offsetYDots: 0, lastProbedAt: 'T', createdAt: 'T' },
  { id: 'prn-2', name: '仓库 B3S', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM1',
    capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
    offsetXDots: 0, offsetYDots: 0, lastProbedAt: 'T', createdAt: 'T' },
  { id: 'prn-zpl', name: '霍尼韦尔', kind: 'zpl', transport: 'tcp', address: '10.0.0.9:9100',
    capabilities: CAPABILITIES, queueState: 'running', queuePausedReason: null,
    offsetXDots: 0, offsetYDots: 0, lastProbedAt: 'T', createdAt: 'T' },
]

const PROFILES: Record<string, Array<Record<string, unknown>>> = {
  'prn-1': [{ id: 'pro-1', printerId: 'prn-1', name: '常规', density: 3, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 }],
  'prn-2': [{ id: 'pro-2', printerId: 'prn-2', name: '加深', density: 5, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 }],
  'prn-zpl': [],
}

const JOB = {
  id: 'job-1',
  printerId: 'prn-1',
  status: 'failed',
  requestedCopies: 100,
  pagesPrinted: 60,
  failureCode: null,
  failureMessage: null,
  snapshot: { templateName: '出货面单', widthMm: 50, heightMm: 30, printerKind: 'niimbot' },
  createdAt: 'T',
  startedAt: null,
  finishedAt: null,
} as unknown as PrintJob

function wrap(node: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true, status: 202,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

beforeEach(() => {
  posted.length = 0
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return json({ jobId: 'job-2', status: 'queued' })
    }
    const profileMatch = /\/api\/printers\/([^/]+)\/profiles/.exec(url)
    if (profileMatch) return json({ profiles: PROFILES[profileMatch[1]!] ?? [] })
    if (url.includes('/api/printers')) return json({ printers: PRINTERS })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = (): void => {
  render(wrap(<ReprintDialog job={JOB} open onOpenChange={() => undefined} onDone={() => undefined} />))
}
const confirm = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /^打印 \d+ 张$/ }))
}

/** The printer list arrives from the server; nothing is selectable until it has. */
const printerSelect = async (): Promise<HTMLElement> => {
  const trigger = await screen.findByRole('combobox', { name: '打印机' })
  await vi.waitFor(() => expect(selectedText(trigger)).not.toBe(''))
  return trigger
}

describe('the printer', () => {
  it('starts on the one the job ran on', async () => {
    open()
    expect(selectedText(await printerSelect())).toContain('前台 B3S')
  })

  it('offers the other machine of the same kind', async () => {
    open()
    await chooseOption(await printerSelect(), '仓库 B3S')
    expect(selectedText(screen.getByRole('combobox', { name: '打印机' }))).toContain('仓库 B3S')
  })

  it('offers a printer of another kind too', async () => {
    // Both drivers are handed a bitmap, so a design has no kind of its own to
    // clash with. Filtering these out would hide a machine that can print the
    // label perfectly well — the gate was removed from the submit path on
    // purpose and must not creep back in here.
    open()
    const trigger = await printerSelect()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(await screen.findByRole('option', { name: /霍尼韦尔/ })).toBeDefined()
  })
})

describe('what gets sent', () => {
  it('sends only the count when nothing was changed', async () => {
    // A plain "print that again" has to keep meaning exactly that: the same
    // machine, the same density, whatever they were.
    open()
    await printerSelect()
    confirm()

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.url).toContain('/api/print-jobs/job-1/reprint')
    expect(Object.keys(posted[0]!.body).sort()).toEqual(['copies'])
  })

  it('sends the printer once another one is chosen', async () => {
    open()
    await chooseOption(await printerSelect(), '仓库 B3S')
    confirm()

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.body.printerId).toBe('prn-2')
  })

  it('sends the parameters once they are chosen', async () => {
    open()
    await printerSelect()
    await chooseOption(screen.getByRole('combobox', { name: '打印参数' }), '常规')
    confirm()

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.body.profileId).toBe('pro-1')
  })

  it('forgets the chosen parameters when the printer changes', async () => {
    // Parameters belong to a printer — density and label type mean something
    // only against a particular head, and the server refuses a mismatch.
    // Carrying the old choice across would turn a printer change into an error
    // message.
    open()
    await printerSelect()
    await chooseOption(screen.getByRole('combobox', { name: '打印参数' }), '常规')
    await chooseOption(screen.getByRole('combobox', { name: '打印机' }), '仓库 B3S')
    confirm()

    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]!.body.printerId).toBe('prn-2')
    expect(posted[0]!.body.profileId).toBeUndefined()
  })
})
