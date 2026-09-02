/**
 * The real `NexusPort`, over `fetch`.
 *
 * The only place in this feature that touches the network, which is what makes
 * the rest of it testable without one.
 *
 * Three decisions worth stating:
 *
 *   - **A timeout, always.** A ledger that accepts the connection and then says
 *     nothing would otherwise hold a refresh open until something else gave up,
 *     and the refresh mutex means one stuck attempt blocks every later one on
 *     that source. Thirty seconds is long enough to assemble ten thousand rows
 *     and short enough that somebody waiting on the button gets an answer.
 *   - **401 and 422 are told apart**, because they are different repairs: a key
 *     the ledger no longer accepts is a deployment problem, and a missing
 *     category id is a bug in this code.
 *   - **The locale is passed through.** The ledger renders its own dates and
 *     booleans into words, and those words go on a label; asking for them in
 *     the language the operator is reading is the whole reason it renders them
 *     rather than sending raw values.
 */
import {
  NexusError,
  nexusCategoriesSchema,
  parseRowEnvelope,
  type NexusCategory,
  type NexusPort,
} from '../domain/nexus.ts'
import type { RowEnvelope } from '@zenith/shared'

export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * What actually went wrong, out of `fetch`'s uniformly useless message.
 *
 * Every network fault rejects with the literal string `fetch failed`; the
 * distinguishing part is `cause.code`. Reporting only the message made a name
 * that does not resolve and a port with nothing behind it the same sentence,
 * and they are opposite repairs — the first is DNS or the wrong network, the
 * second is a service that is down or listening elsewhere. Whoever is holding
 * the failure gets sent to check the wrong thing half the time.
 */
function networkFault(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const cause: unknown = err instanceof Error ? err.cause : undefined
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : undefined
  return code === undefined ? message : `${code}: ${message}`
}

export interface NexusClientOptions {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
}

export function createNexusClient(options: NexusClientOptions): NexusPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const base = options.baseUrl.replace(/\/+$/, '')

  async function get(path: string, locale: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': locale,
          Authorization: `Bearer ${options.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new NexusError('unreachable', networkFault(err))
    }

    if (response.status === 401) {
      throw new NexusError('unauthorised', 'the ledger did not accept the key')
    }
    if (response.status === 422) {
      throw new NexusError('badRequest', 'the ledger refused the request')
    }
    if (!response.ok) {
      throw new NexusError('unreachable', `HTTP ${response.status}`)
    }

    try {
      return await response.json()
    } catch {
      // Not a connection problem: the ledger answered, with something that is
      // not JSON. An HTML error page from a proxy looks exactly like this.
      throw new NexusError('badShape', 'the answer was not JSON')
    }
  }

  return {
    async categories(locale: string): Promise<NexusCategory[]> {
      const parsed = nexusCategoriesSchema.safeParse(await get('/api/categories', locale))
      if (!parsed.success) {
        throw new NexusError('badShape', parsed.error.issues[0]?.message ?? 'unrecognised')
      }
      return parsed.data
    },

    async rows(request): Promise<RowEnvelope> {
      const query = new URLSearchParams({
        category_id: request.categoryId,
        include_descendants: 'true',
        offset: String(request.offset),
        limit: String(request.limit),
      })
      return parseRowEnvelope(await get(`/api/rows?${query.toString()}`, request.locale))
    },
  }
}
