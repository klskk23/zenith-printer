/**
 * The address of the spreadsheet a linked source came from.
 *
 * Small enough to look obviously right and still has a trap in it: the first
 * worksheet of every spreadsheet has gid 0, and 0 is falsy. A `worksheetId &&`
 * anywhere in here silently drops the fragment for the most common sheet there
 * is, landing everybody on whichever tab Google opens by default.
 */
import { describe, expect, it } from 'vitest'
import { spreadsheetUrl } from '../src/features/data-sources/sheet-url.ts'

describe('spreadsheetUrl', () => {
  it('points at the spreadsheet', () => {
    expect(spreadsheetUrl({ spreadsheetId: '1AbC' })).toBe(
      'https://docs.google.com/spreadsheets/d/1AbC/edit',
    )
  })

  it('points at the worksheet when there is one', () => {
    expect(spreadsheetUrl({ spreadsheetId: '1AbC', worksheetId: 12345 })).toBe(
      'https://docs.google.com/spreadsheets/d/1AbC/edit#gid=12345',
    )
  })

  it('keeps gid 0, which is the first sheet of every spreadsheet', () => {
    expect(spreadsheetUrl({ spreadsheetId: '1AbC', worksheetId: 0 })).toBe(
      'https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0',
    )
  })

  it('has no address without a spreadsheet', () => {
    // A local source has none, and neither does a linked one whose fields the
    // server did not send. Returning a half-built URL would open a 404.
    expect(spreadsheetUrl({})).toBeUndefined()
    expect(spreadsheetUrl({ spreadsheetId: '' })).toBeUndefined()
  })
})
