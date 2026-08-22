/**
 * The real `SheetsPort`, and the only place a private key is ever touched.
 *
 * That is deliberate and is what makes two of the spec's requirements checkable
 * by reading rather than by trusting: the key goes from a file into
 * `google-auth-library` and nowhere else — not into a log, not into a response,
 * not into any other data structure. One reference, so there is no third place
 * for it to leak from.
 *
 * Only two endpoints are called. `google-auth-library` is here for the token
 * dance alone (JWT signing, clock skew, expiry, caching) — the sort of
 * security-adjacent arithmetic that is easy to get subtly wrong by hand — and
 * plain `fetch` does the rest.
 */
import { readFileSync } from 'node:fs'
import { JWT } from 'google-auth-library'
import {
  SheetsError,
  type SheetsPort,
  type SpreadsheetInfo,
} from '../domain/google-sheets.ts'

/** Read-only, and only spreadsheets: the least this feature can ask for. */
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Long enough for a slow link, far short of how long anybody watches a spinner. */
export const DEFAULT_TIMEOUT_MS = 30_000

export interface GoogleSheetsClientOptions {
  /** Path to the service-account JSON key. */
  credentialsPath: string
  /** Injectable so a test can force a timeout without waiting for one. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface GoogleSheetsClient extends SheetsPort {
  /** The robot's address — what a spreadsheet must be shared with. */
  readonly clientEmail: string
}

interface ServiceAccountKey {
  client_email?: string
  private_key?: string
}

/**
 * Map a transport or HTTP failure onto the closed set the contract names.
 *
 * 403 and 404 are the pair that matters: "shared with nobody" and "does not
 * exist" send an operator to two different places, and this is the most common
 * first failure of the whole feature. Which one Google actually returns for a
 * spreadsheet that exists but was never shared is **not settled by the
 * documentation** — it is checked by hand (see the feature's quickstart, HW-2).
 * Until that check happens, the 404 wording also mentions sharing.
 */
function classify(status: number): SheetsError {
  if (status === 403) {
    return new SheetsError('notShared', status)
  }
  if (status === 404) {
    return new SheetsError('notFound', status)
  }
  if (status === 401) {
    return new SheetsError('credentialsInvalid', status)
  }
  if (status === 429) {
    return new SheetsError('rateLimited', status)
  }
  return new SheetsError('unreachable', status)
}

export function createGoogleSheetsClient(
  options: GoogleSheetsClientOptions,
): GoogleSheetsClient {
  let key: ServiceAccountKey
  try {
    key = JSON.parse(readFileSync(options.credentialsPath, 'utf8')) as ServiceAccountKey
  } catch (err) {
    throw new Error(
      `could not read the Google credentials at ${options.credentialsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const clientEmail = key.client_email
  const privateKey = key.private_key
  if (clientEmail === undefined || privateKey === undefined) {
    throw new Error(
      `${options.credentialsPath} is not a service-account key: it has no client_email or private_key`,
    )
  }

  const auth = new JWT({ email: clientEmail, key: privateKey, scopes: [SCOPE] })
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const get = async (path: string): Promise<unknown> => {
    let headers: Headers
    try {
      // The key never leaves this call: what comes back is a short-lived
      // access token, and that is all the request below carries.
      headers = await auth.getRequestHeaders()
    } catch {
      throw new SheetsError('credentialsInvalid')
    }

    let response: Response
    try {
      response = await doFetch(`${API}${path}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // A timeout is its own answer: "Google is slow" and "Google is down"
      // lead to different next steps for the operator.
      throw new SheetsError(
        err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable',
      )
    }

    if (!response.ok) {
      throw classify(response.status)
    }
    return response.json()
  }

  return {
    clientEmail,

    async listWorksheets(spreadsheetId: string): Promise<SpreadsheetInfo> {
      // `fields` matters: without it this returns the whole spreadsheet
      // structure — every sheet's properties, conditional formats, protected
      // ranges — for a dropdown that needs a list of names.
      const body = (await get(
        `/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`,
      )) as {
        properties?: { title?: string }
        sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>
      }

      return {
        title: body.properties?.title ?? spreadsheetId,
        worksheets: (body.sheets ?? []).flatMap((sheet) => {
          const id = sheet.properties?.sheetId
          const title = sheet.properties?.title
          return id === undefined || title === undefined ? [] : [{ id, title }]
        }),
      }
    },

    async readWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<string[][]> {
      // FORMATTED_VALUE is also the API default; naming it gives the reason a
      // place to live. UNFORMATTED_VALUE would turn a text `007` into 7 and a
      // date into a serial number — the exact loss the CSV importer refuses.
      const body = (await get(
        `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(worksheetTitle)}` +
          '?valueRenderOption=FORMATTED_VALUE',
      )) as { values?: string[][] }
      return body.values ?? []
    },
  }
}
