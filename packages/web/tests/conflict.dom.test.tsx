/**
 * Drafts meet the server: version conflicts, and labels that are gone.
 *
 * Drafts made "the baseline is stale" a normal state rather than a rare
 * one — a draft can sit for a week. What these pin: the warning comes
 * *before* the editor opens (FR-027), a refused save offers a way to keep
 * the work as a new label rather than a dead end (FR-028), and a draft whose
 * label was deleted is still reachable (FR-030).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { draftStore } from '../src/features/drafts/index.ts'
import { apiError, renderApp, stubApi } from './support/app.tsx'
import { draftInput, ir } from './drafts/support.ts'

const RECT = { id: 'r', type: 'rect', xMm: 2, yMm: 2, widthMm: 20, heightMm: 10, rotation: 0, strokeWidthDots: 2, filled: false, cornerRadiusMm: 0 }
const TEMPLATE = {
  id: 'tpl-1', name: 'test', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [RECT], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 2, hasThumbnail: false,
}

let puts: Array<{ url: string; body: unknown }>
let posts: Array<{ url: string; body: unknown }>
let refuse: boolean

/** Two rects, so the draft can be told from the one-rect template on the canvas. */
const twoRects = () => ({ ...ir(), elements: [ir().elements[0]!, { ...ir().elements[0]!, id: 'r2', xMm: 20 }] })
const rectsOnCanvas = (): number => document.querySelectorAll('[data-label-canvas] svg [data-element-id]').length

beforeEach(() => {
  draftStore.clear()
  puts = []
  posts = []
  refuse = false
  stubApi((url, init) => {
    const method = init?.method ?? 'GET'
    if (url.endsWith('/templates') && method === 'GET') return { templates: [TEMPLATE] }
    if (url.includes('/templates/tpl-1') && method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init?.body)) })
      if (refuse) {
        return apiError(409, {
          code: 'TEMPLATE_VERSION_CONFLICT',
          what: '这张标签已被其他人修改',
          why: '你载入的版本已过期',
          next: '重新载入，或另存为新标签',
        })
      }
      return { ...TEMPLATE, version: 3 }
    }
    if (url.endsWith('/templates') && method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init?.body)) })
      return { ...TEMPLATE, id: 'tpl-9', name: 'copy', version: 1 }
    }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

async function openTile(name: string): Promise<void> {
  const tiles = await screen.findAllByRole('button', { name: new RegExp(name) })
  fireEvent.click(tiles[0]!)
}

describe('a draft whose baseline the server has moved past', () => {
  beforeEach(() => {
    draftStore.write(draftInput({ draftId: 'tpl-1', templateId: 'tpl-1', baseVersion: 1, present: twoRects() }))
  })

  it('warns before the editor opens', async () => {
    renderApp('/')
    await openTile('test')
    expect(await screen.findByText(copy.drafts.staleTitle)).toBeDefined()
  })

  it('keeps the draft when asked to', async () => {
    renderApp('/')
    await openTile('test')
    fireEvent.click(await screen.findByText(copy.drafts.keepDraft))
    await screen.findByLabelText('label canvas')
    await waitFor(() => expect(rectsOnCanvas()).toBe(2))
    expect(draftStore.read('tpl-1')).not.toBeNull()
  })

  it('discards the draft and shows the server version when asked to', async () => {
    renderApp('/')
    await openTile('test')
    fireEvent.click(await screen.findByText(copy.drafts.discardDraft))
    await screen.findByLabelText('label canvas')
    await waitFor(() => expect(rectsOnCanvas()).toBe(1))
    expect(draftStore.read('tpl-1')).toBeNull()
  })
})

describe('a save the server refuses', () => {
  it('offers to save as a new label, and does so without touching the original', async () => {
    refuse = true
    renderApp('/')
    await openTile('test')
    await screen.findByLabelText('label canvas')
    fireEvent.click(screen.getAllByText('文字')[0]!)
    fireEvent.click(screen.getAllByText(copy.templates.update)[0]!)
    await waitFor(() => expect(puts).toHaveLength(1))

    fireEvent.click(await screen.findByText(copy.templates.saveAsNew))
    const dialog = await screen.findByRole('dialog')
    const name = dialog.querySelector('input') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'copy' } })
    fireEvent.click(screen.getAllByText(copy.common.save).find((el) => dialog.contains(el) && el.tagName === 'BUTTON')!)

    await waitFor(() => expect(posts).toHaveLength(1))
    expect((posts[0]!.body as { name: string }).name).toBe('copy')
    expect(puts).toHaveLength(1)
    await waitFor(() => expect(draftStore.read('tpl-1')).toBeNull())
  })
})

describe('a draft whose label the server no longer has', () => {
  it('is listed, opens, and says what happened', async () => {
    stubApi((url) => {
      if (url.endsWith('/templates')) return { templates: [] }
      if (url.includes('/printers')) return { printers: [] }
      if (url.includes('/print-jobs')) return { jobs: [] }
      return undefined
    })
    draftStore.write(draftInput({ draftId: 'gone', templateId: 'gone', baseVersion: 1, name: '旧标签', present: twoRects() }))
    renderApp('/')
    expect(await screen.findByText(copy.labels.orphan)).toBeDefined()
    await openTile('旧标签')
    await screen.findByLabelText('label canvas')
    expect(await screen.findByText(copy.drafts.orphanTitle)).toBeDefined()
    await waitFor(() => expect(rectsOnCanvas()).toBe(2))
  })
})
