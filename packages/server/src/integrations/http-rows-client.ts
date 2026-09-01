/**
 * The real `HttpRowsPort`, over `fetch`.
 *
 * The only place in the feature that touches the network, which is what makes
 * the rest of it testable without one.
 *
 * Two decisions worth stating:
 *
 *   - **A timeout, always.** A producer that accepts the connection and then
 *     says nothing would otherwise hold a refresh open until something else
 *     gave up, and the refresh mutex means a stuck one blocks every later
 *     attempt on that source. Thirty seconds is long enough for a producer
 *     assembling ten thousand rows and short enough that a person waiting on
 *     the button gets an answer.
 *   - **A body that is not JSON is not an error here.** It comes back as
 *     `undefined` and the caller reports the shape it wanted; the port's job is
 *     transport, and "the producer served an HTML error page" is a shape
 *     problem, not a connection problem.
 */
import type { HttpRowsPort, HttpRowsRequest, HttpRowsResponse } from '../domain/http-rows.ts'

export const DEFAULT_TIMEOUT_MS = 30_000

export function createHttpRowsClient(timeoutMs = DEFAULT_TIMEOUT_MS): HttpRowsPort {
  return {
    async get(request: HttpRowsRequest): Promise<HttpRowsResponse> {
      const response = await fetch(request.url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...request.headers },
        signal: AbortSignal.timeout(timeoutMs),
      })

      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      return { status: response.status, body }
    },
  }
}
