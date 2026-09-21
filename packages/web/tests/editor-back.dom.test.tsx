/**
 * Leaving the editor: a way back, and one question when it would cost something.
 *
 * The rule is "leaving is abandoning". So the back button goes straight to
 * the gallery when nothing has changed, asks when something has, and on
 * "discard" the edits are gone — reopening the label shows what the server
 * has. The sidebar goes through the same gate; the back button is only the
 * nearer way to the same door.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { openLabel, openNewLabel, renderApp, stubApi } from './support/app.tsx'

const RECT = { id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10, rotation: 0, strokeWidthDots: 2, filled: false, cornerRadiusMm: 0 }
const TEMPLATE = {
  id: 'tpl-1', name: 'test', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [RECT], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

const elementsOnCanvas = (): number => document.querySelectorAll('[data-label-canvas] svg [data-element-id]').length
const addText = (): void => {
  fireEvent.click(screen.getAllByText('文字')[0]!)
}
const back = (): void => {
  fireEvent.click(screen.getByText(copy.editor.back))
}

beforeEach(() => {
  stubApi((url) => {
    if (url.endsWith('/templates')) return { templates: [TEMPLATE] }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

describe('the back button', () => {
  it('returns to the gallery when nothing has changed', async () => {
    renderApp('/')
    await openNewLabel()
    back()
    expect(await screen.findByRole('heading', { name: copy.labels.heading })).toBeDefined()
    expect(window.location.pathname).toBe('/')
  })

  it('asks when there are unsaved edits', async () => {
    renderApp('/')
    await openNewLabel()
    addText()
    back()
    expect(await screen.findByText(copy.workspace.leaveTitle)).toBeDefined()
    // Still in the editor: nothing was thrown away by asking.
    expect(document.querySelector('[data-label-canvas]')).not.toBeNull()
  })

  it('stays when told to', async () => {
    renderApp('/')
    await openNewLabel()
    addText()
    back()
    fireEvent.click(await screen.findByText(copy.workspace.leaveStay))
    await waitFor(() => expect(screen.queryByText(copy.workspace.leaveTitle)).toBeNull())
    expect(elementsOnCanvas()).toBe(1)
  })

  it('discards the edits when told to, so reopening shows the saved label', async () => {
    renderApp('/')
    await openLabel('test')
    addText()
    expect(elementsOnCanvas()).toBe(2)
    back()
    fireEvent.click(await screen.findByText(copy.workspace.leaveAnyway))
    await screen.findByRole('heading', { name: copy.labels.heading })

    await openLabel('test')
    await waitFor(() => expect(elementsOnCanvas()).toBe(1))
  })
})

describe('the sidebar', () => {
  it('goes through the same question', async () => {
    renderApp('/')
    await openNewLabel()
    addText()
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    expect(await screen.findByText(copy.workspace.leaveTitle)).toBeDefined()
    expect(document.querySelector('[data-label-canvas]')).not.toBeNull()
  })
})
