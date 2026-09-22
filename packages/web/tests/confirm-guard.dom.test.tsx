/**
 * The confirm address, opened cold.
 *
 * A bookmark or a refresh can land on `/labels/{id}/confirm` with none of the
 * choices made — no machine, no rows. A summary of nothing is worse than no
 * page at all, so the step hands back to where the choices are, without
 * leaving a history entry to bounce off.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const TEMPLATE = {
  id: 'tpl-1', name: '种子路由器', printerKind: 'niimbot', widthMm: 60, heightMm: 40, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

beforeEach(() => {
  stubApi((url) => {
    if (url.includes('/templates/')) return TEMPLATE
    if (url.endsWith('/templates')) return { templates: [TEMPLATE] }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/profiles')) return { profiles: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

describe('opening the confirm step with nothing to confirm', () => {
  it('hands back to the print step', async () => {
    renderApp('/labels/tpl-1/confirm')
    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1/print'))
    expect(await screen.findByRole('radiogroup', { name: copy.print.printer })).toBeDefined()
  })

  it('does not leave a history entry to bounce off', async () => {
    const before = window.history.length
    renderApp('/labels/tpl-1/confirm')
    await waitFor(() => expect(window.location.pathname).toBe('/labels/tpl-1/print'))
    expect(window.history.length).toBe(before)
  })
})
