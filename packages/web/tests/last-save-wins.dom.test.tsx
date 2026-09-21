/**
 * Two people, one label: the last save wins.
 *
 * The server keeps its version token and refuses a save made against a stale
 * one. The client does not turn that into a dead end: it fetches the current
 * version and saves again, once. The person who pressed the button is the
 * last one, and gets their way. A second refusal is shown, not retried —
 * something else is wrong by then.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { apiError, openLabel, renderApp, stubApi } from './support/app.tsx'

const TEMPLATE = {
  id: 'tpl-1', name: 'test', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
  elements: [], variables: [], dataSourceId: null, bindingIssue: null,
  createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false,
}

let puts: Array<{ version: number }>
let serverVersion: number
let refusals: number

beforeEach(() => {
  puts = []
  serverVersion = 1
  refusals = 0
  stubApi((url, init) => {
    const method = init?.method ?? 'GET'
    if (url.endsWith('/templates') && method === 'GET') return { templates: [{ ...TEMPLATE, version: serverVersion }] }
    if (url.includes('/templates/tpl-1') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { version: number }
      puts.push({ version: body.version })
      if (body.version !== serverVersion) {
        refusals += 1
        return apiError(409, { code: 'TEMPLATE_VERSION_CONFLICT', what: '这张标签已被其他人修改', why: '版本已过期', next: '重新载入' })
      }
      serverVersion += 1
      return { ...TEMPLATE, version: serverVersion }
    }
    if (url.includes('/printers')) return { printers: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

describe('saving over somebody else\'s save', () => {
  it('retries once against their version and wins', async () => {
    renderApp('/')
    await openLabel('test')
    // Somebody saved while this label was open: the server is now at 5, and
    // the version this editor loaded with (1) is stale.
    serverVersion = 5
    fireEvent.click(screen.getAllByText('文字')[0]!)
    fireEvent.click(screen.getAllByText(copy.templates.update)[0]!)

    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts.map((put) => put.version)).toEqual([1, 5])
    expect(refusals).toBe(1)
    expect(serverVersion).toBe(6)
    await waitFor(() => expect(screen.queryByText(/已被其他人修改/)).toBeNull())
  })

  it('shows the refusal when the retry is refused too', async () => {
    renderApp('/')
    await openLabel('test')
    // The server keeps moving: every fetch says a version the next PUT will miss.
    stubApi((url, init) => {
      const method = init?.method ?? 'GET'
      if (url.endsWith('/templates') && method === 'GET') {
        serverVersion += 1
        return { templates: [{ ...TEMPLATE, version: serverVersion - 1 }] }
      }
      if (url.includes('/templates/tpl-1') && method === 'PUT') {
        puts.push({ version: (JSON.parse(String(init?.body)) as { version: number }).version })
        return apiError(409, { code: 'TEMPLATE_VERSION_CONFLICT', what: '这张标签已被其他人修改', why: '版本已过期', next: '重新载入' })
      }
      if (url.includes('/printers')) return { printers: [] }
      if (url.includes('/print-jobs')) return { jobs: [] }
      return undefined
    })
    fireEvent.click(screen.getAllByText('文字')[0]!)
    fireEvent.click(screen.getAllByText(copy.templates.update)[0]!)
    expect(await screen.findByText(/已被其他人修改/)).toBeDefined()
    expect(puts.length).toBe(2)
  })
})
