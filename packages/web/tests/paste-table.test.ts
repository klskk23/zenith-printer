import { describe, expect, it } from 'vitest'
import {
  PasteOverflowsColumnsError,
  applyPaste,
  pasteGrid,
} from '../src/features/data-sources/paste.ts'

const COLUMNS = ['订单号', '收件人', '数量']

describe('pasteGrid', () => {
  it('splits a spreadsheet block on tabs and newlines', () => {
    expect(pasteGrid('A-001\t张三\nA-002\t李四')).toEqual([
      ['A-001', '张三'],
      ['A-002', '李四'],
    ])
  })

  it('ignores the trailing newline a spreadsheet adds', () => {
    // Excel puts one there. Treating it as a row would append a blank line on
    // every paste.
    expect(pasteGrid('A-001\t张三\r\n')).toEqual([['A-001', '张三']])
  })

  it('keeps a quoted newline inside one cell', () => {
    expect(pasteGrid('A\t"上海市\n浦东新区"')).toEqual([['A', '上海市\n浦东新区']])
  })

  it('treats plain text with no tabs as a single cell', () => {
    // Pasting a value into a cell is the most ordinary thing to do here
    // (FR-050).
    expect(pasteGrid('张三')).toEqual([['张三']])
  })

  it('keeps a leading zero', () => {
    expect(pasteGrid('007')).toEqual([['007']])
  })

  it('returns nothing for an empty clipboard', () => {
    expect(pasteGrid('')).toEqual([])
  })
})

describe('applyPaste', () => {
  it('lays the block down from the selected cell', () => {
    const result = applyPaste('张三\t5\n李四\t8', COLUMNS, 4, { ordinal: 2, columnIndex: 1 })
    expect(result.upserts).toEqual([
      { ordinal: 2, values: { 收件人: '张三', 数量: '5' } },
      { ordinal: 3, values: { 收件人: '李四', 数量: '8' } },
    ])
  })

  it('touches only the columns the block covers', () => {
    // A paste into one column must not blank the others on that row.
    const result = applyPaste('张三', COLUMNS, 4, { ordinal: 1, columnIndex: 1 })
    expect(result.upserts[0]?.values).toEqual({ 收件人: '张三' })
  })

  it('appends rows past the end of the table', () => {
    const result = applyPaste('a\nb\nc', COLUMNS, 2, { ordinal: 2, columnIndex: 0 })
    expect(result.appended).toBe(2)
    expect(result.upserts.map((u) => u.ordinal)).toEqual([2, 3, 4])
  })

  it('appends nothing when the block fits inside the table', () => {
    const result = applyPaste('a\nb', COLUMNS, 10, { ordinal: 1, columnIndex: 0 })
    expect(result.appended).toBe(0)
  })

  it('refuses a block wider than the columns left, and says by how much', () => {
    // A column name is what a design references; one that arrived from a paste
    // would have got there without anybody choosing to call it that (FR-049).
    try {
      applyPaste('a\tb\tc', COLUMNS, 4, { ordinal: 1, columnIndex: 1 })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PasteOverflowsColumnsError)
      expect(err).toMatchObject({ needed: 3, available: 2 })
    }
  })

  it('measures against the widest row, not the first', () => {
    // A ragged block whose second row is wider would otherwise slip through
    // and silently lose its last column.
    expect(() => applyPaste('a\nb\tc\td\te', COLUMNS, 4, { ordinal: 1, columnIndex: 0 })).toThrow(
      PasteOverflowsColumnsError,
    )
  })

  it('accepts a block that fits exactly', () => {
    expect(() => applyPaste('a\tb\tc', COLUMNS, 4, { ordinal: 1, columnIndex: 0 })).not.toThrow()
  })

  it('does nothing for an empty clipboard', () => {
    expect(applyPaste('', COLUMNS, 4, { ordinal: 1, columnIndex: 0 })).toEqual({
      upserts: [],
      appended: 0,
    })
  })

  it('preserves a 20x2 block whole, which is the reported use', () => {
    // SC-007: copy a block out of Google Sheets, paste it in, no file in
    // between and nothing lost.
    const block = Array.from({ length: 20 }, (_unused, i) => `A-${i}\t收件人${i}`).join('\n')
    const result = applyPaste(block, COLUMNS, 0, { ordinal: 1, columnIndex: 0 })
    expect(result.upserts).toHaveLength(20)
    expect(result.upserts[19]).toEqual({ ordinal: 20, values: { 订单号: 'A-19', 收件人: '收件人19' } })
  })
})
