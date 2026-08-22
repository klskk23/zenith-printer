/**
 * A `SheetsPort` that never touches the network.
 *
 * Used by the entire test suite. The constitution forbids tests that depend on
 * the network outright, so there is no "sometimes real" mode here — the two
 * facts about Google that genuinely need a live call are checked by hand
 * instead (see `specs/004-google-sheets-source/quickstart.md`).
 */
import {
  SheetsError,
  type SheetsErrorKind,
  type SheetsPort,
  type SpreadsheetInfo,
} from '../domain/google-sheets.ts'

export interface FakeSheetsScript {
  spreadsheets?: Record<string, SpreadsheetInfo>
  /** Keyed `${spreadsheetId}/${worksheetTitle}`. First row is the header. */
  values?: Record<string, string[][]>
  /** Fail every call this way, whatever else the script says. */
  failWith?: SheetsErrorKind
}

export interface FakeSheetsPort extends SheetsPort {
  /** Lets a test assert that nothing reached Google at all. */
  readonly calls: { listWorksheets: number; readWorksheet: number }
}

export function fakeSheetsPort(script: FakeSheetsScript): FakeSheetsPort {
  const calls = { listWorksheets: 0, readWorksheet: 0 }

  return {
    calls,

    listWorksheets(spreadsheetId: string): Promise<SpreadsheetInfo> {
      calls.listWorksheets += 1
      if (script.failWith !== undefined) {
        return Promise.reject(new SheetsError(script.failWith))
      }
      const found = script.spreadsheets?.[spreadsheetId]
      if (found === undefined) {
        // Not an empty spreadsheet: that would look legitimate, and the caller
        // would go on to build a zero-column data source out of nothing.
        return Promise.reject(new SheetsError('notFound', 404))
      }
      return Promise.resolve(found)
    },

    readWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<string[][]> {
      calls.readWorksheet += 1
      if (script.failWith !== undefined) {
        return Promise.reject(new SheetsError(script.failWith))
      }
      if (script.spreadsheets?.[spreadsheetId] === undefined) {
        return Promise.reject(new SheetsError('notFound', 404))
      }
      const values = script.values?.[`${spreadsheetId}/${worksheetTitle}`]
      if (values === undefined) {
        return Promise.reject(new SheetsError('worksheetMissing'))
      }
      return Promise.resolve(values)
    },
  }
}
