/**
 * Where a linked source's rows actually live.
 *
 * Checking a number against the sheet is the commonest reason to leave this
 * page, and the alternative is copying the spreadsheet id out of a dialog and
 * assembling the address by hand.
 */

/**
 * The Google address for a linked source, or nothing when it is not linked.
 *
 * `worksheetId` is written even when it is 0 — that is the first worksheet of
 * every spreadsheet, and `worksheetId &&` would drop the fragment for the most
 * common sheet there is, landing everybody on whichever tab Google opens by
 * default.
 */
export function spreadsheetUrl(source: {
  spreadsheetId?: string
  worksheetId?: number
}): string | undefined {
  if (source.spreadsheetId === undefined || source.spreadsheetId.length === 0) {
    return undefined
  }
  const base = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit`
  return source.worksheetId === undefined ? base : `${base}#gid=${source.worksheetId}`
}
