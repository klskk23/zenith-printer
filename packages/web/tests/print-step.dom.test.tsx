/**
 * The print step, walked the way somebody walks it.
 *
 * Driven through the real app from the gallery, because the things worth
 * pinning are all about what arrives from elsewhere: the machine list, the
 * settings that follow a machine, the rows that follow a binding, and the
 * count at the foot that follows all three.
 *
 * What must not be here: a preview, a standing warning about paper, a drawing
 * of the print head. Those were the dialog's; the ordinary path is silent now.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const CAPS = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}
const PRINTERS = [
  {
    id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/a',
    capabilities: CAPS, queueState: 'running', queuePausedReason: null,
    lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
  },
  {
    id: 'prn-2', name: '仓库机', kind: 'zpl', transport: 'tcp', address: '10.0.0.5:9100',
    capabilities: null, queueState: 'running', queuePausedReason: null,
    lastProbedAt: null, createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
  },
]
const PROFILES = [
  { id: 'pf-1', printerId: 'prn-1', name: '小卷', density: 3, labelType: 1, labelWidthMm: 40, labelHeightMm: 20,
    marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: true, createdAt: 'T' },
  { id: 'pf-2', printerId: 'prn-1', name: '原厂', density: 3, labelType: 1, labelWidthMm: 50, labelHeightMm: 30,
    marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: false, createdAt: 'T' },
]
const SOURCE = { id: 'ds-1', name: '资产台账', columns: ['sys_id'], rowCount: 4, createdAt: 'T', updatedAt: 'T', origin: null }
const ROWS = Array.from({ length: 4 }, (_unused, i) => ({ ordinal: i + 1, values: { sys_id: `FW-00284${i + 1}` } }))

const template = (dataSourceId: string | null) => ({
  id: 'tpl-1', name: '种子路由器', printerKind: 'niimbot', widthMm: 40, heightMm: 20, dpi: 203,
  elements: [], variables: [], dataSourceId, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
})

let bound = true

beforeEach(() => {
  bound = true
  stubApi((url) => {
    if (url.includes('/templates/')) return template(bound ? 'ds-1' : null)
    if (url.endsWith('/templates')) return { templates: [template(bound ? 'ds-1' : null)] }
    if (url.includes('/profiles')) return { profiles: PROFILES }
    if (url.includes('/printers')) return { printers: PRINTERS }
    if (url.includes('/rows')) return { rows: ROWS, page: 1, pageSize: 10, total: ROWS.length }
    if (url.endsWith('/data-sources')) return { dataSources: [SOURCE] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

const printers = (): HTMLElement => screen.getByRole('radiogroup', { name: copy.print.printer })
const chosenIn = (group: string): string =>
  [...screen.getByRole('radiogroup', { name: group }).querySelectorAll('[role="radio"]')]
    .find((card) => card.getAttribute('aria-checked') === 'true')?.textContent ?? ''
const foot = (): string => document.querySelector('[data-tally]')?.textContent ?? ''
const continueButton = (): HTMLButtonElement => document.querySelector('[data-continue]') as HTMLButtonElement

async function open(): Promise<void> {
  renderApp('/labels/tpl-1/print')
  // The group is drawn before the machines arrive; wait for the machines.
  await screen.findByRole('radio', { name: '前台机' })
}

describe('choosing a machine', () => {
  it('says what each one is, and whether anybody has probed it', async () => {
    await open()
    const cards = within(printers()).getAllByRole('radio')
    expect(cards[0]!.textContent).toContain('B3S_P')
    expect(cards[0]!.textContent).toContain('203 dpi')
    expect(cards[1]!.textContent).toContain(copy.status.notProbed)
  })

  it('brings that machine’s default settings with it', async () => {
    await open()
    fireEvent.click(within(printers()).getByRole('radio', { name: '前台机' }))
    // 小卷 is marked default; 原厂 is merely first in nothing.
    await waitFor(() => expect(chosenIn(copy.profiles.heading)).toContain('小卷'))
  })
})

describe('the foot of the page', () => {
  it('counts rows times copies, and updates as either changes', async () => {
    await open()
    fireEvent.click(within(printers()).getByRole('radio', { name: '前台机' }))
    fireEvent.click(await screen.findByRole('button', { name: /^全选/ }))
    await waitFor(() => expect(foot()).toContain('4'))

    fireEvent.click(screen.getByRole('button', { name: copy.common.increase }))
    await waitFor(() => expect(foot()).toContain('8'))
  })

  it('keeps the count in the bar rather than under the table', async () => {
    // The table is the one thing here that grows; anything below it is pushed
    // out of sight by a long enough data source.
    await open()
    const bar = document.querySelector('[data-tally]')!.closest('div.border-t')
    expect(bar).not.toBeNull()
    expect(bar!.contains(document.querySelector('[data-row-selection], table'))).toBe(false)
  })

  it('refuses to go on until a machine is chosen, and says why', async () => {
    await open()
    expect(continueButton().disabled).toBe(true)
    expect(document.querySelector('[data-blocked]')?.textContent).toBe(copy.print.needsPrinter)
  })

  it('refuses while a bound label has no rows ticked', async () => {
    await open()
    fireEvent.click(within(printers()).getByRole('radio', { name: '前台机' }))
    await waitFor(() => expect(document.querySelector('[data-blocked]')?.textContent).toBe(copy.rowSelection.none))
    expect(continueButton().disabled).toBe(true)
  })

  it('goes on once both are answered', async () => {
    await open()
    fireEvent.click(within(printers()).getByRole('radio', { name: '前台机' }))
    fireEvent.click(await screen.findByRole('button', { name: /^全选/ }))
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1/confirm'))
  })
})

describe('a label bound to nothing', () => {
  it('asks only about the machine and its settings', async () => {
    bound = false
    await open()
    expect(screen.queryByRole('button', { name: /^全选/ })).toBeNull()
    // The copies field has not moved: it is in the same bar as before.
    expect(screen.getByRole('spinbutton', { name: copy.print.copiesPerRow })).toBeDefined()
  })

  it('counts the copies alone', async () => {
    bound = false
    await open()
    fireEvent.click(within(printers()).getByRole('radio', { name: '前台机' }))
    fireEvent.click(screen.getByRole('button', { name: copy.common.increase }))
    await waitFor(() => expect(foot()).toContain('2'))
  })
})

describe('what the page no longer carries', () => {
  it('shows no preview, no standing paper warning, and no head figure', async () => {
    await open()
    const page = document.body.textContent ?? ''
    expect(page).not.toContain('打印会消耗标签纸')
    expect(document.querySelector('[data-head-figure]')).toBeNull()
    expect(document.querySelector('[data-print-preview]')).toBeNull()
  })
})
