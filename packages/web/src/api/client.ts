/**
 * API client.
 *
 * Every failure arrives in the four-field shape the REST contract guarantees,
 * so the UI can branch on the stable `code` and show the prose unchanged —
 * there is no place in the frontend that invents its own wording.
 */
import { QueryClient } from '@tanstack/react-query'
import { copy } from '../i18n/zh-CN.ts'

export interface ApiErrorBody {
  code: string
  what: string
  why: string
  next: string
  details?: Record<string, unknown>
}

/** A failed request, carrying the server's own copy. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(`${body.code}: ${body.what}`)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }

  /** The device is off or unreachable — somebody has to walk over to it. */
  get needsSomeoneOnSite(): boolean {
    return this.body.code === 'PRINTER_UNREACHABLE'
  }
}

// The only client-side copy: every other message comes from the server
// already worded, so one fault never gets two descriptions.
const FALLBACK: ApiErrorBody = { code: 'NETWORK_ERROR', ...copy.networkError }

async function parseError(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>
    if (typeof body.code === 'string' && typeof body.what === 'string') {
      return body as ApiErrorBody
    }
  } catch {
    // Fall through to the generic message below.
  }
  return FALLBACK
}

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Required for anything that consumes stock (FR-017). */
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.idempotencyKey !== undefined) {
    // A refresh or a retry must not burn a second batch of labels.
    headers['Idempotency-Key'] = options.idempotencyKey
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch {
    throw new ApiRequestError(0, FALLBACK)
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, await parseError(response))
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Job state is polled (there is no push channel); two seconds is plenty
      // for a hundred-copy run that takes minutes.
      refetchInterval: 2000,
      retry: (failureCount, error) => {
        // Never retry a rejection the user has to act on; only transient ones.
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
          return false
        }
        return failureCount < 2
      },
    },
    mutations: {
      // Printing is irreversible: an automatic retry could produce a second
      // batch of physical labels.
      retry: false,
    },
  },
})
