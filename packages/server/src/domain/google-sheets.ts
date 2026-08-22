/**
 * The seam between this system and Google.
 *
 * Everything the feature needs from a spreadsheet passes through `SheetsPort`,
 * and nothing else does. That is what lets the whole test suite run with no
 * network: the tests inject a fake, and the real client is only ever used at
 * runtime. Same shape as the printer drivers behind their transport.
 *
 * The port is deliberately narrow — two calls, not a wrapper around the Sheets
 * API. A narrow port has a fake that can be trusted; a wide one becomes a
 * second Google to maintain.
 */
import { z } from 'zod'

export interface SpreadsheetInfo {
  title: string
  worksheets: ReadonlyArray<{ id: number; title: string }>
}

export interface SheetsPort {
  /** The spreadsheet's title and its worksheets. Reads no cells. */
  listWorksheets(spreadsheetId: string): Promise<SpreadsheetInfo>

  /**
   * Every value in one worksheet, first row included.
   *
   * Takes the worksheet's **title**, not its id: the Sheets read endpoint uses
   * A1 notation and only knows titles. Callers hold the id — which survives a
   * rename — and turn it into the current title via `listWorksheets` first.
   */
  readWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<string[][]>
}

/**
 * Why a read failed, as a closed set.
 *
 * This set is part of the contract: the spec's failure categories, the REST
 * response's `reason`, and the command line's output all derive from it. A new
 * member here means a new sentence for the operator, which is the point —
 * "it didn't work" is not something anybody can act on.
 */
export const SHEETS_ERROR_KINDS = [
  'notShared',
  'notFound',
  'worksheetMissing',
  'credentialsInvalid',
  'rateLimited',
  'unreachable',
  'timeout',
] as const

export type SheetsErrorKind = (typeof SHEETS_ERROR_KINDS)[number]

export class SheetsError extends Error {
  readonly kind: SheetsErrorKind
  /** The original HTTP status, for debug logs only — never shown to a user. */
  readonly status: number | undefined

  constructor(kind: SheetsErrorKind, status?: number) {
    super(`google sheets read failed: ${kind}`)
    this.name = 'SheetsError'
    this.kind = kind
    this.status = status
  }
}

/**
 * The id inside a spreadsheet URL.
 *
 * Accepts what people actually paste — the full edit URL, one with a `gid`
 * fragment or a sharing query, or the bare id copied out of the address bar.
 * Returns null for anything else rather than guessing: a wrong id produces a
 * "not found" that sends the operator looking at the wrong problem.
 */
export function spreadsheetIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return null
  }

  const inUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed)
  if (inUrl !== null) {
    return inUrl[1] ?? null
  }

  // A bare id. Google's are long and made of this alphabet; requiring both
  // keeps a stray word from being taken for one.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return trimmed
  }
  return null
}

/** The worksheet id (`gid`) named in a URL fragment, when there is one. */
export function worksheetIdFrom(input: string): number | null {
  const gid = /[#&?]gid=(\d+)/.exec(input)
  if (gid === null) {
    return null
  }
  const parsed = Number(gid[1])
  return Number.isSafeInteger(parsed) ? parsed : null
}

export const spreadsheetUrlSchema = z.string().min(1)
