/**
 * Turning a worksheet's values into columns and rows.
 *
 * The header is the first row, and a column name is a reference name — a design
 * writes `${收件人}`. So the rules here are the same ones the CSV importer
 * already enforces, and for the same reason: a column that arrives malformed
 * becomes a reference nobody can write, or worse, one that silently resolves to
 * nothing on a printed label.
 */
import { describe, expect, it } from 'vitest'
import { tableFromValues, TableShapeError } from '../../src/domain/sheet-table.ts'

describe('reading a worksheet into a table', () => {
  it('takes the first row as the header', () => {
    const table = tableFromValues([
      ['订单号', '收件人'],
      ['A-001', '张三'],
    ])
    expect(table.columns).toEqual(['订单号', '收件人'])
    expect(table.rows).toEqual([{ 订单号: 'A-001', 收件人: '张三' }])
  })

  it('pads a short row rather than leaving keys missing', () => {
    // Sheets omits trailing empties. A missing key would read as "leave the old
    // value" downstream, so every row must carry every column.
    const table = tableFromValues([
      ['订单号', '收件人', '备注'],
      ['A-001'],
    ])
    expect(table.rows[0]).toEqual({ 订单号: 'A-001', 收件人: '', 备注: '' })
  })

  it('ignores cells beyond the header, which name no column', () => {
    // A stray value in an unnamed column would otherwise invent a column name.
    const table = tableFromValues([
      ['订单号'],
      ['A-001', '草稿'],
    ])
    expect(table.columns).toEqual(['订单号'])
    expect(table.rows[0]).toEqual({ 订单号: 'A-001' })
  })

  it('keeps values exactly as given, leading zeros and all', () => {
    const table = tableFromValues([
      ['编号', '日期'],
      ['007', '2026-08-22'],
    ])
    expect(table.rows[0]).toEqual({ 编号: '007', 日期: '2026-08-22' })
  })

  it('accepts a worksheet with a header and no data rows', () => {
    const table = tableFromValues([['订单号', '收件人']])
    expect(table.columns).toEqual(['订单号', '收件人'])
    expect(table.rows).toEqual([])
  })

  it('refuses a worksheet with nothing in it', () => {
    expect(() => tableFromValues([])).toThrow(TableShapeError)
    expect(() => tableFromValues([])).toThrow(/empty/)
  })

  it('refuses a header row that is entirely blank', () => {
    expect(() => tableFromValues([['', '  '], ['A-001']])).toThrow(/empty/)
  })

  it('refuses a duplicate column name, as the CSV importer does', () => {
    // Two columns of the same name make `${订单号}` ambiguous, and nothing
    // downstream could resolve it.
    expect(() => tableFromValues([['订单号', '订单号'], ['A', 'B']])).toThrow(/duplicate/)
  })

  it('trims the header, since a trailing space is invisible in a reference', () => {
    const table = tableFromValues([[' 订单号 '], ['A-001']])
    expect(table.columns).toEqual(['订单号'])
  })

  it('drops trailing blank header cells rather than inventing a nameless column', () => {
    // Sheets often reports a few empty columns past the real ones.
    const table = tableFromValues([['订单号', '收件人', '', ''], ['A-001', '张三']])
    expect(table.columns).toEqual(['订单号', '收件人'])
  })

  it('refuses a blank header cell that sits between two real ones', () => {
    // Not trailing slack: a hole in the middle means the sheet is not shaped
    // the way the operator thinks it is, and guessing would hide that.
    expect(() => tableFromValues([['订单号', '', '收件人'], ['A', 'B', 'C']])).toThrow(/blank/)
  })
})
