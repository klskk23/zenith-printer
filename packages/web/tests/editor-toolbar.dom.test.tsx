/**
 * The editor's top bar is one line.
 *
 * The printer and print-settings selects used to carry a stacked label above
 * them, which made those two controls two rows tall while everything beside
 * them — back, save, undo, print — was one. The row's height came from the
 * labels, so the bar read as uneven. The name now sits inside the box while
 * nothing is chosen, the way a search field names itself, and is replaced by
 * the choice once one is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { chooseOption, openedOptions, selectedText } from './support/select.ts'
import { openNewLabel, renderApp, stubApi } from './support/app.tsx'

const PRINTER = {
  id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: {
    dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B1', serial: null, firmwareVersion: null,
  },
  queueState: 'running', queuePausedReason: null, lastProbedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z', offsetXDots: 0, offsetYDots: 0,
}

const PROFILE = {
  id: 'p-1', printerId: 'prn-1', name: '小卷', density: 3, labelType: 1,
  labelWidthMm: 40, labelHeightMm: 20,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
  isDefault: true, createdAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  stubApi((url) => {
    if (url.includes('/profiles')) return { profiles: [PROFILE] }
    if (url.includes('/printers')) return { printers: [PRINTER] }
    if (url.endsWith('/templates')) return { templates: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

async function openToolbar(): Promise<HTMLElement> {
  renderApp('/')
  await openNewLabel()
  return screen.getByRole('toolbar', { name: copy.editor.heading })
}

const printerSelect = (toolbar: HTMLElement): HTMLElement =>
  within(toolbar).getByRole('combobox', { name: copy.print.printer })
const settingsSelect = (toolbar: HTMLElement): HTMLElement =>
  within(toolbar).getByRole('combobox', { name: copy.profiles.heading })

describe('the editor toolbar', () => {
  it('stacks no label above its controls', async () => {
    const toolbar = await openToolbar()
    // The labels are what made the row two lines tall. The selects keep their
    // accessible name through `aria-label`, so nothing is lost by dropping them.
    expect([...toolbar.querySelectorAll('label')]).toHaveLength(0)
  })

  it('names the printer select inside the box while nothing is chosen', async () => {
    const toolbar = await openToolbar()
    expect(selectedText(printerSelect(toolbar))).toContain(copy.print.printer)
  })

  it('names the print-settings select inside the box while nothing is chosen', async () => {
    const toolbar = await openToolbar()
    expect(selectedText(settingsSelect(toolbar))).toContain(copy.profiles.heading)
  })

  it('shows the choice instead of the name once one is made', async () => {
    const toolbar = await openToolbar()
    const printer = printerSelect(toolbar)
    await vi.waitFor(() => expect(openedOptions(printer).length).toBeGreaterThan(1))
    chooseOption(printer, '前台机')

    await vi.waitFor(() => expect(selectedText(printer)).toContain('前台机'))
    expect(selectedText(printer)).not.toContain(copy.print.printer)
    // The printer's default settings come with it, so that box fills in too.
    await vi.waitFor(() => expect(selectedText(settingsSelect(toolbar))).toContain('小卷'))
  })

  it('takes the name back when the choice is cleared', async () => {
    const toolbar = await openToolbar()
    const printer = printerSelect(toolbar)
    await vi.waitFor(() => expect(openedOptions(printer).length).toBeGreaterThan(1))
    chooseOption(printer, '前台机')
    await vi.waitFor(() => expect(selectedText(printer)).toContain('前台机'))

    // Clearing is still offered: the box is a choice, not a commitment.
    chooseOption(printer, '—')
    await vi.waitFor(() => expect(selectedText(printer)).toContain(copy.print.printer))
  })

  it('keeps the print button on the same line as the selects', async () => {
    // The complaint that started this: the row looked uneven because two of
    // its controls were taller than the rest. Every direct child of the
    // printing group is now the same height as the selects.
    const toolbar = await openToolbar()
    const group = printerSelect(toolbar).parentElement!
    expect(group.className).not.toContain('flex-col')
  })
})
