/**
 * The print dialog shows where the label falls on the head.
 *
 * Drawn for a probed printer, marked when the label hangs off, absent — with
 * the existing "not probed" sentence — when the head width is unknown. The
 * overflow *notice* the dialog already had is untouched: this is a picture,
 * not a second warning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { labelIrSchema } from '@zenith/shared'
import { PrintDialog } from '../src/features/print/print-dialog.tsx'
import { copy } from '../src/i18n/index.ts'

const CAPABILITIES = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}

const printer = (capabilities: typeof CAPABILITIES | null) => ({
  id: 'prn-1', name: 'B3S_P', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities, queueState: 'running', queuePausedReason: null,
  lastProbedAt: capabilities === null ? null : '2026-08-22T00:00:00.000Z', createdAt: '2026-08-22T00:00:00.000Z',
  offsetXDots: 0, offsetYDots: 0,
})

const ir = (widthMm: number) =>
  labelIrSchema.parse({
    widthMm, heightMm: 30, dpi: 203,
    elements: [{ id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 10, heightMm: 10, strokeWidthDots: 2 }],
  })

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

function open(widthMm: number, capabilities: typeof CAPABILITIES | null): void {
  render(
    wrap(
      <PrintDialog
        ir={ir(widthMm)}
        templateId={null}
        profileId="pro-1"
        printer={printer(capabilities) as never}
        variableValues={{}}
        unresolved={[]}
        dataSourceId={null}
        onClose={() => undefined}
      />,
    ),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined })
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const url = String(input)
    const body = url.includes('preflight') ? { warnings: [] } : url.includes('/profiles') ? { profiles: [] } : {}
    return Promise.resolve({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': url.includes('/preview') ? 'image/png' : 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      blob: () => Promise.resolve(new Blob()),
    } as unknown as Response)
  }))
})

describe('the head figure', () => {
  it('is drawn for a probed printer, to scale', () => {
    open(40, CAPABILITIES)
    const figure = document.querySelector('[data-head-figure]')
    expect(figure).not.toBeNull()
    // 384 dots at 203 dpi is 48.05 mm; the caption says both numbers.
    const label = figure!.querySelector('svg')!.getAttribute('aria-label') ?? ''
    expect(label).toContain('40')
    expect(label).toContain('48')
    expect(figure!.getAttribute('data-overflow')).toBeNull()
  })

  it('marks how much of a wide label hangs off', () => {
    open(60, CAPABILITIES)
    const figure = document.querySelector('[data-head-figure]')!
    expect(figure.getAttribute('data-overflow')).toBe('true')
    expect(figure.querySelector('[data-overflow-mark]')).not.toBeNull()
    expect(figure.textContent).toContain(copy.print.headOverflow(12))
  })

  it('is absent for an unprobed printer, which the dialog already explains', () => {
    open(40, null)
    expect(document.querySelector('[data-head-figure]')).toBeNull()
    expect(screen.getAllByText(copy.print.needsProbe).length).toBeGreaterThan(0)
  })
})
