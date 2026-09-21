/**
 * The sidebar as one piece of furniture: name, entries, printers.
 *
 * What is pinned: the product name lives here and nowhere else (there is no
 * top bar), every entry carries an icon, the API console is not an entry,
 * and the printers at the foot say what the service knows about each — with
 * the model that cannot report its stock told about rather than left blank.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const caps = (supportsConsumableLevel: boolean) => ({
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3, paperTypes: [1],
  printDirection: 'top', supportsConsumableLevel, model: null, serial: null, firmwareVersion: null,
})
const printer = (id: string, name: string, capabilities: unknown) => ({
  id, name, kind: 'niimbot', transport: 'serial', address: '/dev/a', capabilities,
  queueState: 'running', queuePausedReason: null, lastProbedAt: null, createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
})

beforeEach(() => {
  stubApi((url) => {
    if (url.endsWith('/templates')) return { templates: [] }
    if (url.includes('/printers')) {
      return { printers: [printer('a', '前台机', caps(true)), printer('b', '仓库机', caps(false)), printer('c', '新机', null)] }
    }
    if (url.includes('/print-jobs')) return { jobs: [] }
    if (url.includes('/health')) return { status: 'ok' }
    return undefined
  })
})

afterEach(cleanup)

describe('the sidebar', () => {
  it('carries the product name, once', () => {
    renderApp('/')
    const nav = document.querySelector('nav')!
    expect(nav.querySelector('[data-brand]')?.textContent).toContain('Zenith Printer')
    expect(screen.getAllByText('Zenith Printer')).toHaveLength(1)
  })

  it('gives every entry an icon', () => {
    renderApp('/')
    const nav = document.querySelector('nav')!
    for (const button of nav.querySelectorAll('ol button')) {
      expect(button.querySelector('svg'), `${button.textContent} has no icon`).not.toBeNull()
    }
  })

  it('does not list the API console', () => {
    renderApp('/')
    expect(document.querySelector('nav')!.textContent).not.toContain(copy.workspace.pages['api-docs'])
  })

  it('folds the printers into one line at its foot, which opens on a click', async () => {
    renderApp('/')
    const foot = document.querySelector('[data-sidebar-printers]') as HTMLButtonElement
    await waitFor(() => expect(foot.textContent).toContain(copy.status.printersCount(3)))
    // Nothing about any one printer is on the page until asked.
    expect(document.body.textContent).not.toContain('前台机')

    fireEvent.click(foot)
    const panel = await screen.findByText('前台机')
    const lines = panel.closest('[data-sidebar-printers-panel]')!
    expect(lines.textContent).toContain(copy.status.remainingSupported)
    expect(lines.textContent).toContain(copy.status.remainingUnsupported)
    expect(lines.textContent).toContain(copy.status.notProbed)
  })

  it('says when there are no printers, on the line and in the panel', async () => {
    stubApi((url) => {
      if (url.includes('/printers')) return { printers: [] }
      if (url.includes('/print-jobs')) return { jobs: [] }
      return url.endsWith('/templates') ? { templates: [] } : undefined
    })
    renderApp('/')
    const foot = document.querySelector('[data-sidebar-printers]') as HTMLButtonElement
    await waitFor(() => expect(foot.textContent).toContain(copy.status.printersCount(0)))
    fireEvent.click(foot)
    expect(await screen.findByText(copy.status.noPrinters)).toBeDefined()
  })

  it('shows whether the service is reachable', async () => {
    renderApp('/')
    const line = document.querySelector('[data-connection]')!
    await waitFor(() => expect(line.textContent).toContain(copy.connection.connected))
  })
})
