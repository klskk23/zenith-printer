/**
 * The gallery: the home page, and the only list of labels.
 *
 * What it must do that the old library did not: show unsaved work at the
 * top, draw every label at its real proportions, fill a bound label's
 * picture with the first row of its table, and open the editor on a click
 * with the sidebar still there. What it must not do: count, say 「模板」,
 * or wait for the table before showing the paper.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { draftStore } from '../src/features/drafts/index.ts'
import { thumbnailBoxPx } from '../src/features/templates/thumbnail-box.ts'
import { renderApp, stubApi } from './support/app.tsx'
import { draftInput, ir } from './drafts/support.ts'

const base = {
  printerKind: 'niimbot', dpi: 203, variables: [], bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}
const TEXT = (content: string) => ({
  id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 6, content,
  fontFamily: 'Noto Sans CJK SC', fontSizeMm: 4, rotation: 0, align: 'left', bold: false, inverted: false,
})
const SHELF = { ...base, id: 'tpl-shelf', name: '货架标签', widthMm: 50, heightMm: 30, dataSourceId: 'ds-1', elements: [TEXT('货位 ${货位号}')] }
const WAYBILL = { ...base, id: 'tpl-waybill', name: '出货面单', widthMm: 100, heightMm: 150, dataSourceId: null, elements: [TEXT('单号 ${单号}')] }
const STRIP = { ...base, id: 'tpl-strip', name: '线缆标牌', widthMm: 10, heightMm: 200, dataSourceId: null, elements: [] }
const SOURCE = { id: 'ds-1', name: '货架位表', columns: ['货位号'], rowCount: 96, createdAt: 'T', updatedAt: 'T', origin: null }

let rowsFail = false

beforeEach(() => {
  draftStore.clear()
  rowsFail = false
  stubApi((url) => {
    if (url.endsWith('/templates')) return { templates: [SHELF, WAYBILL, STRIP] }
    if (url.includes('/data-sources/ds-1/rows')) {
      if (rowsFail) throw new Error('rows down')
      return { rows: [{ ordinal: 1, values: { 货位号: 'A-12-03' } }], page: 1, pageSize: 1, total: 96 }
    }
    if (url.endsWith('/data-sources')) return { dataSources: [SOURCE] }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

const tile = (name: string): HTMLElement =>
  screen.getAllByRole('button', { name: new RegExp(name) })[0]!.closest('[data-gallery-tile]') as HTMLElement

const frameOf = (name: string): HTMLElement => tile(name).querySelector('[data-thumbnail-frame]') as HTMLElement

const ratioOf = (el: HTMLElement): number => parseFloat(el.style.width) / parseFloat(el.style.height)

describe('the gallery', () => {
  it('is the home page and never counts', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    const heading = screen.getByRole('heading', { name: copy.labels.heading })
    expect(heading.textContent).toBe(copy.labels.heading)
    expect(screen.queryByText(/^\d+$/)).toBeNull()
  })

  it('draws each label at its own proportions, clamped to the tile', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    const limits = { maxWidthPx: 240, maxHeightPx: 140 }
    expect(Math.abs(ratioOf(frameOf('货架标签')) - 50 / 30)).toBeLessThan(0.01 * (50 / 30))
    expect(Math.abs(ratioOf(frameOf('出货面单')) - 100 / 150)).toBeLessThan(0.01 * (100 / 150))
    // The 10 × 200 strip hits the height cap: tall, not proportional, still visible.
    const strip = frameOf('线缆标牌')
    const expected = thumbnailBoxPx({ widthMm: 10, heightMm: 200 }, limits)
    expect(parseFloat(strip.style.height)).toBe(expected.heightPx)
    expect(parseFloat(strip.style.width)).toBeGreaterThanOrEqual(12)
    expect(parseFloat(strip.style.height)).toBeLessThanOrEqual(limits.maxHeightPx)
  })

  it('fills a bound label\'s picture with the first row, and an unbound one with placeholders', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    await waitFor(() => {
      const img = frameOf('货架标签').querySelector('img') as HTMLImageElement
      expect(decodeURIComponent(img.src)).toContain('A-12-03')
    })
    const waybill = frameOf('出货面单').querySelector('img') as HTMLImageElement
    expect(decodeURIComponent(waybill.src)).toContain('${')
  })

  it('shows the paper before the table answers, and keeps it when the table fails', async () => {
    rowsFail = true
    renderApp('/')
    await screen.findAllByText('货架标签')
    const img = frameOf('货架标签').querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(decodeURIComponent(img.src)).toContain('${')
  })

  it('opens the editor on a click, with the sidebar still there and no back button', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    fireEvent.click(screen.getAllByRole('button', { name: /货架标签/ })[0]!)
    await screen.findByLabelText('label canvas')
    expect(document.querySelector('nav')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /返回/ })).toBeNull()
    expect(window.location.pathname).toBe('/labels/tpl-shelf')
  })

  it('puts an unsaved new label first, marked, and a saved label\'s draft marked in place', async () => {
    draftStore.write(draftInput({ draftId: 'd-1', templateId: null, baseVersion: null, name: null, present: ir() }))
    draftStore.write(draftInput({ draftId: 'tpl-shelf', templateId: 'tpl-shelf', baseVersion: 1, present: ir() }))
    renderApp('/')
    await screen.findAllByText('货架标签')
    const tiles = [...document.querySelectorAll('[data-gallery-tile]')]
    expect(tiles[0]!.getAttribute('data-unsaved')).toBe('true')
    expect(tiles[0]!.textContent).toContain(copy.labels.untitled)
    expect(tile('货架标签').getAttribute('data-unsaved')).toBe('true')
    expect(tile('出货面单').getAttribute('data-unsaved')).toBeNull()
  })

  it('opens a new label from the button and lists it at once', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    fireEvent.click(screen.getAllByText(copy.labels.new)[0]!)
    await screen.findByLabelText('label canvas')
    expect(window.location.pathname).toMatch(/^\/labels\/new\/.+/)
  })

  it('shows the empty state with the strip still above it', async () => {
    stubApi((url) => {
      if (url.endsWith('/templates')) return { templates: [] }
      if (url.includes('/printers')) return { printers: [] }
      if (url.includes('/print-jobs')) return { jobs: [] }
      return undefined
    })
    renderApp('/')
    expect(await screen.findByText(copy.labels.empty)).toBeDefined()
    expect(document.querySelector('[data-status-strip]')).not.toBeNull()
  })
})

describe('clearing unsaved drafts', () => {
  it('lists what it will clear, clears on confirm, and leaves saved labels alone', async () => {
    for (let i = 1; i <= 3; i += 1) {
      draftStore.write(draftInput({ draftId: `d-${i}`, templateId: null, baseVersion: null, name: `试打 ${i}`, present: ir() }))
    }
    draftStore.write(draftInput({ draftId: 'tpl-shelf', templateId: 'tpl-shelf', baseVersion: 1, present: ir() }))
    draftStore.write(draftInput({ draftId: 'tpl-waybill', templateId: 'tpl-waybill', baseVersion: 1, present: ir() }))
    renderApp('/')
    await screen.findAllByText('货架标签')

    fireEvent.click(screen.getByText(copy.labels.clearDrafts))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain(copy.labels.clearDraftsBody(5))
    for (const name of ['试打 1', '试打 2', '试打 3', '货架标签', '出货面单']) {
      expect(dialog.textContent).toContain(name)
    }

    fireEvent.click(screen.getByText(copy.labels.clearDraftsConfirm))
    await waitFor(() => expect(draftStore.list().entries).toEqual([]))
    await waitFor(() => expect(document.querySelectorAll('[data-unsaved]')).toHaveLength(0))
    expect(screen.getAllByText('货架标签').length).toBeGreaterThan(0)
    expect(screen.getAllByText('出货面单').length).toBeGreaterThan(0)
  })

  it('does nothing on cancel', async () => {
    draftStore.write(draftInput({ draftId: 'd-1', templateId: null, baseVersion: null, present: ir() }))
    renderApp('/')
    await screen.findAllByText('货架标签')
    fireEvent.click(screen.getByText(copy.labels.clearDrafts))
    fireEvent.click(await screen.findByText(copy.common.cancel))
    expect(draftStore.list().entries).toHaveLength(1)
  })

  it('is disabled when there is nothing to clear', async () => {
    renderApp('/')
    await screen.findAllByText('货架标签')
    expect((screen.getByText(copy.labels.clearDrafts).closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
