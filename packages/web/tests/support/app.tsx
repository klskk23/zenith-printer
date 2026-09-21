/**
 * Driving the whole application in a test, the way a person does.
 *
 * There is no tab bar and no "label design" entry any more: the gallery is
 * the home page, a label is opened by clicking it, and a new one by the
 * button. Tests that used to click 「标签设计」 in the sidebar go through
 * these instead, so that when the way in changes again it changes here.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { App } from '../../src/App.tsx'
import { copy } from '../../src/i18n/index.ts'

export function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

export const jsonResponse = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve({
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)

/** An error the server would send: the four-field body, at a status. */
export function apiError(status: number, body: { code: string; what: string; why?: string; next?: string }): ApiFailure {
  return { __apiStatus: status, body: { why: '', next: '', ...body } }
}

interface ApiFailure {
  __apiStatus: number
  body: unknown
}

const isFailure = (value: unknown): value is ApiFailure =>
  typeof value === 'object' && value !== null && '__apiStatus' in value

/**
 * A fetch that answers from a table of routes and `{}` for everything else.
 * A route returns `undefined` to fall through, or `apiError(...)` to refuse.
 */
export function stubApi(routes: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input)
      const body = routes(url, init)
      if (isFailure(body)) {
        return jsonResponse(body.body, body.__apiStatus)
      }
      return jsonResponse(body === undefined ? {} : body)
    }),
  )
}

/** Mount the app at an address. */
export function renderApp(address = '/'): void {
  window.history.replaceState(null, '', address)
  render(wrap(<App />))
}

/** Click 「新建标签」 on the gallery and wait for the canvas. */
export async function openNewLabel(): Promise<void> {
  fireEvent.click(screen.getAllByText(copy.labels.new)[0]!)
  await screen.findByLabelText('label canvas')
}

/** Click a label's tile on the gallery and wait for the canvas. */
export async function openLabel(name: string): Promise<void> {
  const tiles = await screen.findAllByRole('button', { name: new RegExp(name) })
  fireEvent.click(tiles[0]!)
  await screen.findByLabelText('label canvas')
}
