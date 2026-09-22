/**
 * The address a sheet has to be shared with.
 *
 * It used to sit in the page's body, under a paragraph explaining what a data
 * source is. The paragraph is gone — it explained the product to somebody who
 * only wanted to link a sheet — and the address moved into the `?` beside the
 * title, where it can be copied rather than read out loud to somebody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { renderApp, stubApi } from './support/app.tsx'

const ADDRESS = 'zenithpt@gen-lang-client-0485815917.iam.gserviceaccount.com'
let configured = true

beforeEach(() => {
  configured = true
  stubApi((url) => {
    if (url.includes('/google/status')) {
      return configured ? { configured: true, clientEmail: ADDRESS } : { configured: false, clientEmail: null }
    }
    if (url.endsWith('/data-sources')) return { dataSources: [] }
    if (url.includes('/nexus')) return { configured: false }
    if (url.endsWith('/templates')) return { templates: [] }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

const openPage = async (): Promise<void> => {
  renderApp('/data-sources')
  await screen.findByRole('heading', { name: copy.dataSources.heading })
  // The status is a query like any other; the mark appears when it answers.
  await waitFor(() => expect(document.querySelector('[data-page-header]')).not.toBeNull())
}

describe('the data sources page', () => {
  it('no longer explains what a data source is', async () => {
    await openPage()
    expect(document.body.textContent).not.toContain('一个数据源就是一张表')
  })

  it('keeps the address behind the title’s mark', async () => {
    await openPage()
    expect(document.body.textContent).not.toContain(ADDRESS)
    const mark = await screen.findByRole('button', { name: copy.common.hintFor(copy.dataSources.heading) })
    fireEvent.click(mark)
    await waitFor(() => expect(document.querySelector('[data-hint-value]')?.textContent).toBe(ADDRESS))
  })

  it('offers to copy it', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    await openPage()
    fireEvent.click(await screen.findByRole('button', { name: copy.common.hintFor(copy.dataSources.heading) }))
    fireEvent.click(await screen.findByText(copy.common.copy))
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('says what is missing instead, when nobody configured Google', async () => {
    configured = false
    await openPage()
    // A state, not an explanation: it stays in the page.
    expect(await screen.findByText(copy.dataSources.googleNotConfigured)).toBeDefined()
    expect(screen.queryByRole('button', { name: copy.common.hintFor(copy.dataSources.heading) })).toBeNull()
  })
})
