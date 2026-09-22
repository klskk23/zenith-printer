/**
 * What counts as editing a label, and what does not.
 *
 * The rule is "leaving is abandoning", so the question on the way out has to
 * be asked about real edits only. Choosing a machine on the print step is not
 * one: the canvas follows that machine's stock so the preview is honest, but
 * nobody should be asked whether to keep a change they never made.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const CAPS = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
  model: 'B3S_P', serial: null, firmwareVersion: null,
}
const PRINTER = {
  id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/a',
  capabilities: CAPS, queueState: 'running', queuePausedReason: null,
  lastProbedAt: 'T', createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}
/** A different stock from the label's own 50×30, so applying it changes the canvas. */
const PROFILE = {
  id: 'pf-1', printerId: 'prn-1', name: '小卷', density: 3, labelType: 1,
  labelWidthMm: 40, labelHeightMm: 20,
  marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, isDefault: true, createdAt: 'T',
}
const TEMPLATE = {
  id: 'tpl-1', name: '种子路由器', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

/** A label bound to a table, whose first row arrives after it opens. */
const SOURCE = { id: 'ds-1', name: '资产台账', columns: ['sn'], rowCount: 2, createdAt: 'T', updatedAt: 'T', origin: null }
const BOUND = {
  ...TEMPLATE,
  id: 'tpl-2',
  dataSourceId: 'ds-1',
  elements: [
    {
      id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, rotation: 0,
      symbology: 'code128', content: '${sn}', showText: true, moduleWidthDots: 2,
    },
  ],
}

beforeEach(() => {
  stubApi((url) => {
    if (url.includes('/templates/tpl-2')) return BOUND
    if (url.includes('/templates/')) return TEMPLATE
    if (url.endsWith('/templates')) return { templates: [TEMPLATE, BOUND] }
    if (url.includes('/rows')) return { rows: [{ ordinal: 1, values: { sn: 'FW-002841-LONG-VALUE' } }], page: 1, pageSize: 1, total: 2 }
    if (url.endsWith('/data-sources')) return { dataSources: [SOURCE] }
    if (url.includes('/profiles')) return { profiles: [PROFILE] }
    if (url.includes('/printers')) return { printers: [PRINTER] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

const leaveToGallery = (): void => {
  fireEvent.click(document.querySelector('[data-step="labels"] button')!)
}

describe('choosing a machine', () => {
  it('does not turn the label into unsaved work', async () => {
    renderApp('/labels/tpl-1/print')
    fireEvent.click(await screen.findByRole('radio', { name: '前台机' }))
    // The default settings arrive and resize the canvas to their stock.
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: '小卷' }).getAttribute('aria-checked'),
      ).toBe('true'),
    )

    leaveToGallery()
    expect(screen.queryByText(copy.workspace.leaveTitle)).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})

describe('opening a label bound to a table', () => {
  it('is not unsaved work, however the boxes settle', async () => {
    // The first row arrives after the label does and the barcode's frame
    // follows its content. Nobody did that, so nobody should be asked about
    // it on the way out.
    renderApp('/labels/tpl-2')
    await screen.findByLabelText('label canvas')
    await waitFor(() =>
      expect((screen.getByLabelText(copy.editor.canvasWidth) as HTMLInputElement).value).toBe('50'),
    )

    leaveToGallery()
    expect(screen.queryByText(copy.workspace.leaveTitle)).toBeNull()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})

describe('an edit made on the design step', () => {
  it('still asks on the way out, and survives a trip to printing', async () => {
    renderApp('/labels/tpl-1')
    await screen.findByLabelText('label canvas')
    // Wait for the stored label to land: editing the blank one the editor
    // opens with would be undone the moment the real one arrives.
    await waitFor(() =>
      expect((screen.getByLabelText(copy.editor.canvasWidth) as HTMLInputElement).value).toBe('50'),
    )
    fireEvent.click(screen.getAllByText('文字')[0]!)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-label-canvas] svg [data-element-id]')).toHaveLength(1),
    )
    // Step forward and back: the flow keeps the session, so the edit is still
    // there — and the question is still owed on the way out.
    fireEvent.click(document.querySelector('[data-continue]')!)
    await screen.findByRole('radiogroup', { name: copy.print.printer })
    fireEvent.click(document.querySelector('[data-step="design"] button')!)
    await screen.findByLabelText('label canvas')

    leaveToGallery()
    expect(await screen.findByText(copy.workspace.leaveTitle)).toBeDefined()
  })
})
