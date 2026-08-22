/**
 * Getting a spreadsheet id out of whatever somebody pasted.
 *
 * Refusing is as important as accepting: a wrong id produces a "not found",
 * which sends the operator to check whether the spreadsheet was deleted rather
 * than to check what they pasted.
 */
import { describe, expect, it } from 'vitest'
import { spreadsheetIdFrom, worksheetIdFrom } from '../../src/domain/google-sheets.ts'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x'

describe('the spreadsheet id in a link', () => {
  it('reads the plain edit URL', () => {
    expect(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe(ID)
  })

  it('reads one with a worksheet fragment', () => {
    expect(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=77`)).toBe(ID)
  })

  it('reads one with a sharing query', () => {
    expect(
      spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`),
    ).toBe(ID)
  })

  it('reads a bare id', () => {
    expect(spreadsheetIdFrom(ID)).toBe(ID)
  })

  it('ignores surrounding whitespace, which a paste often brings', () => {
    expect(spreadsheetIdFrom(`  https://docs.google.com/spreadsheets/d/${ID}/edit \n`)).toBe(ID)
  })

  it('refuses a link to something else on Google', () => {
    expect(spreadsheetIdFrom('https://docs.google.com/document/d/abc/edit')).toBeNull()
  })

  it('refuses a short word rather than treating it as an id', () => {
    expect(spreadsheetIdFrom('hello')).toBeNull()
  })

  it('refuses an empty string', () => {
    expect(spreadsheetIdFrom('   ')).toBeNull()
  })
})

describe('the worksheet id in a link', () => {
  it('reads the gid fragment when there is one', () => {
    expect(worksheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=77`)).toBe(77)
  })

  it('reads gid 0, which is the first worksheet and is falsy', () => {
    // Guards against a `|| null` that would turn the first worksheet into "none".
    expect(worksheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(0)
  })

  it('is null when the link names no worksheet', () => {
    expect(worksheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBeNull()
  })
})
