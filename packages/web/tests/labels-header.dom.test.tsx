/**
 * The gallery's head, and the two ways into a label.
 *
 * The page used to open with the word 「标签」 written twice: once as its own
 * title and once as the first step in the bar above it. The title went; the
 * line it occupied now carries the only thing there that changes — whether the
 * queue is running, and how the last print went.
 *
 * Each label offers two doors. Most days the job is "print these three rows",
 * which has nothing to do with laying the label out, so printing is a door of
 * its own rather than a button found inside the editor.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const TEMPLATE = {
  id: 'tpl-1', name: '种子路由器', printerKind: 'niimbot', widthMm: 60, heightMm: 40, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

const PRINTER = {
  id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/a',
  capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
  createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
}

beforeEach(() => {
  stubApi((url) => {
    if (url.endsWith('/templates')) return { templates: [TEMPLATE] }
    // A queue line needs a machine to be about.
    if (url.includes('/printers')) return { printers: [PRINTER] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

describe('the gallery head', () => {
  it('stands on the first of the four steps', async () => {
    renderApp('/')
    await screen.findByText('种子路由器')
    const bar = screen.getByRole('toolbar', { name: copy.flow.heading })
    expect(bar.querySelectorAll('[data-step]')).toHaveLength(4)
    expect(bar.querySelector('[data-state="current"]')?.getAttribute('data-step')).toBe('labels')
    // Nowhere to go back to: this is the way out.
    expect(bar.querySelector('[data-back]')).toBeNull()
  })

  it('does not name itself twice', async () => {
    renderApp('/')
    await screen.findByText('种子路由器')
    // The step bar says where this is; a heading saying it again is furniture.
    expect(screen.queryByRole('heading', { name: copy.labels.heading })).toBeNull()
  })

  it('gives the line to the queue instead', async () => {
    renderApp('/')
    const head = document.querySelector('[data-labels-head]')!
    await waitFor(() => expect(head.textContent).toContain(copy.status.queueRunning))
    // And the four things somebody does from here.
    expect(head.textContent).toContain(copy.templates.exportAll)
    expect(head.textContent).toContain(copy.labels.new)
    expect(within(head as HTMLElement).getByPlaceholderText(copy.labels.searchPlaceholder)).toBeDefined()
  })

  it('keeps a fading rule between the head and the labels', async () => {
    renderApp('/')
    await screen.findByText('种子路由器')
    expect(document.querySelector('[data-labels-head] ~ [data-slot="separator"]')).not.toBeNull()
  })
})

describe('a label tile', () => {
  const tile = async (): Promise<HTMLElement> => {
    renderApp('/')
    await screen.findByText('种子路由器')
    return document.querySelector('[data-gallery-tile]') as HTMLElement
  }

  it('offers printing first, before the housekeeping', async () => {
    const actions = [...(await tile()).querySelectorAll('[data-tile-actions] button')]
    expect(actions.map((button) => button.textContent?.trim())).toEqual([
      copy.flow.steps.print,
      copy.templates.rename,
      copy.templates.export,
      copy.templates.remove,
    ])
  })

  it('keeps its four actions on one line, whatever the language', async () => {
    // 「Print Rename Export Delete」 at the button's usual padding ran past the
    // tile and dropped 「Delete」 onto a line of its own.
    const actions = (await tile()).querySelector('[data-tile-actions]')!
    expect(actions.className).not.toContain('flex-wrap')
    for (const button of actions.querySelectorAll('button')) {
      expect(button.className, `${button.textContent} still carries padding`).toContain('px-0')
    }
  })

  it('goes straight to the print step, skipping the editor', async () => {
    const node = await tile()
    fireEvent.click(within(node).getByRole('button', { name: copy.flow.steps.print }))
    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1/print'))
    expect(await screen.findByRole('radiogroup', { name: copy.print.printer })).toBeDefined()
  })

  it('still opens the editor when the label itself is clicked', async () => {
    const node = await tile()
    fireEvent.click(within(node).getAllByRole('button', { name: '种子路由器' })[0]!)
    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1'))
  })
})
