/**
 * The last look, and what happens after the button.
 *
 * Five lines and a number: what is being printed, where, with which settings,
 * from which rows, how many each. One sentence more only when something is
 * about to be cut off. Then the same page becomes the receipt, because the
 * job's number is worth keeping and a dialog that closes takes it away.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi, apiError } from './support/app.tsx'

const CAPS = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}
const PRINTER = {
  id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: CAPS, queueState: 'running', queuePausedReason: null,
  lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}
const PROFILE = {
  id: 'pf-1', printerId: 'prn-1', name: '小卷', density: 3, labelType: 1,
  labelWidthMm: 40, labelHeightMm: 20,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: true, createdAt: 'T',
}
const SOURCE = { id: 'ds-1', name: '资产台账', columns: ['sys_id'], rowCount: 3, createdAt: 'T', updatedAt: 'T', origin: null }
const ROWS = [1, 2, 3].map((n) => ({ ordinal: n, values: { sys_id: `FW-00284${n}` } }))
const TEMPLATE = {
  id: 'tpl-1', name: '种子路由器', printerKind: 'niimbot', widthMm: 40, heightMm: 20, dpi: 203,
  elements: [], variables: [], dataSourceId: 'ds-1', bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

/** Warnings the preflight answers with; empty is the ordinary case. */
let warnings: unknown[] = []
let submitFails = false
const submissions: Array<{ key: string | null; body: unknown }> = []

beforeEach(() => {
  warnings = []
  submitFails = false
  submissions.length = 0
  stubApi((url, init) => {
    if (url.includes('/print-jobs/preflight')) return { warnings }
    if (url.includes('/print-jobs') && init?.method === 'POST') {
      submissions.push({
        key: new Headers(init.headers).get('idempotency-key'),
        body: JSON.parse(String(init.body)),
      })
      return submitFails
        ? apiError(409, { code: 'QUEUE_PAUSED', what: '队列已暂停', why: '有人按了暂停', next: '先恢复队列再试' })
        : { jobId: 'job-9', status: 'queued', printerId: 'prn-1', requestedCopies: 3 }
    }
    if (url.includes('/templates/')) return TEMPLATE
    if (url.endsWith('/templates')) return { templates: [TEMPLATE] }
    if (url.includes('/profiles')) return { profiles: [PROFILE] }
    if (url.includes('/printers')) return { printers: [PRINTER] }
    if (url.includes('/rows')) return { rows: ROWS, page: 1, pageSize: 10, total: ROWS.length }
    if (url.endsWith('/data-sources')) return { dataSources: [SOURCE] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

/** Walk in from the print step, the way anybody arrives here. */
async function reachConfirm(): Promise<void> {
  renderApp('/labels/tpl-1/print')
  fireEvent.click(await screen.findByRole('radio', { name: '前台机' }))
  fireEvent.click(await screen.findByRole('button', { name: /^全选/ }))
  await waitFor(() => expect((document.querySelector('[data-continue]') as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(document.querySelector('[data-continue]')!)
  // The step bar says 「确认」 too; wait for the page's own heading.
  await screen.findByRole('heading', { name: copy.flow.steps.confirm })
}

const line = (term: string): string =>
  document.querySelector(`[data-term="${term}"]`)?.textContent ?? ''

describe('the summary', () => {
  it('lists what is being printed, where, and how many', async () => {
    await reachConfirm()
    expect(line(copy.presets.template)).toContain('种子路由器')
    expect(line(copy.presets.template)).toContain('40 × 20 mm')
    expect(line(copy.print.printer)).toContain('前台机')
    expect(line(copy.profiles.heading)).toContain('小卷')
    expect(line(copy.dataSources.heading)).toContain('资产台账')
    expect(line(copy.print.copiesPerRow)).toContain('1')
    expect(document.querySelector('[data-total]')?.textContent).toBe('3')
  })

  it('says nothing about clipping when nothing will be clipped', async () => {
    await reachConfirm()
    expect(document.querySelector('[data-clip]')).toBeNull()
    // And none of the dialog's standing furniture came with it.
    expect(document.body.textContent).not.toContain('打印会消耗标签纸')
  })

  it('says so when a row will lose content, and still lets it print', async () => {
    warnings = [
      { rowIndex: 2, elementId: 'e1', reason: 'BARCODE_TOO_WIDE', actualWidthMm: 49, availableWidthMm: 40 },
    ]
    await reachConfirm()
    const clip = await waitFor(() => {
      const node = document.querySelector('[data-clip]')
      expect(node).not.toBeNull()
      return node!
    })
    expect(clip.textContent).toContain('9')
    expect((document.querySelector('[data-submit]') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('submitting', () => {
  it('sends the batch and turns into a receipt', async () => {
    await reachConfirm()
    fireEvent.click(document.querySelector('[data-submit]')!)

    const result = await screen.findByText(copy.print.queuedCount(3))
    expect(result).toBeDefined()
    expect(screen.getByText(copy.print.queuedDetail('job-9'))).toBeDefined()
    for (const way of [copy.print.toQueue, copy.print.again, copy.print.backToLabels]) {
      expect(screen.getByText(way)).toBeDefined()
    }
  })

  it('sends the rows and the design, not the canvas’ own values', async () => {
    await reachConfirm()
    fireEvent.click(document.querySelector('[data-submit]')!)
    await waitFor(() => expect(submissions).toHaveLength(1))
    const body = submissions[0]!.body as Record<string, unknown>
    expect(body.rowSelection).toEqual({ all: true })
    expect(body).toHaveProperty('ir')
    expect(body).not.toHaveProperty('variableValues')
  })

  it('carries an idempotency key, and the same one on a retry', async () => {
    // A double click or a replayed request must return the original job
    // rather than a second stack of labels.
    submitFails = true
    await reachConfirm()
    fireEvent.click(document.querySelector('[data-submit]')!)
    await screen.findByText('队列已暂停')

    submitFails = false
    fireEvent.click(document.querySelector('[data-submit]')!)
    await waitFor(() => expect(submissions).toHaveLength(2))
    expect(submissions[0]!.key).not.toBeNull()
    expect(submissions[1]!.key).toBe(submissions[0]!.key)
  })

  it('stays put and says what happened when the server refuses', async () => {
    submitFails = true
    await reachConfirm()
    fireEvent.click(document.querySelector('[data-submit]')!)
    const error = await screen.findByText('队列已暂停')
    const box = error.closest('[data-submit-error]')!
    // What happened, why, and what to do — all three.
    expect(box.textContent).toContain('有人按了暂停')
    expect(box.textContent).toContain('先恢复队列再试')
    expect(document.querySelector('[data-submit]')).not.toBeNull()
  })

  it('goes back for another batch with the machine still chosen', async () => {
    await reachConfirm()
    fireEvent.click(document.querySelector('[data-submit]')!)
    fireEvent.click(await screen.findByText(copy.print.again))

    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1/print'))
    const group = screen.getByRole('radiogroup', { name: copy.print.printer })
    expect(within(group).getByRole('radio', { name: '前台机' }).getAttribute('aria-checked')).toBe('true')
    // The rows are cleared: a second batch is a new question.
    await waitFor(() =>
      expect(document.querySelector('[data-blocked]')?.textContent).toBe(copy.rowSelection.none),
    )
  })
})
