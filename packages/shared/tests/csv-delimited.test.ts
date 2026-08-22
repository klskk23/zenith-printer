import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseDelimited, splitRow } from '../src/csv/parse-delimited.ts'

/**
 * RFC 4180 quoting, shared by the CSV importer and the clipboard paste.
 *
 * One implementation for both because they must agree: a cell containing a
 * newline is quoted in a spreadsheet's TSV exactly as it is in a CSV, and two
 * parsers disagreeing about that would split one row into two on paste.
 */
describe('splitRow', () => {
  it('splits on the delimiter', () => {
    expect(splitRow('a,b,c', ',')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a delimiter that sits inside quotes', () => {
    expect(splitRow('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
  })

  it('unescapes a doubled quote', () => {
    expect(splitRow('a,"say ""hi""",c', ',')).toEqual(['a', 'say "hi"', 'c'])
  })

  it('keeps empty cells, including trailing ones', () => {
    // A trailing empty cell is a real column with no value, not an absent one.
    expect(splitRow('a,,c,', ',')).toEqual(['a', '', 'c', ''])
  })

  it('treats a quote inside an unquoted cell as an ordinary character', () => {
    expect(splitRow('5" pipe,x', ',')).toEqual(['5" pipe', 'x'])
  })

  it('works with tabs, which is what a spreadsheet puts on the clipboard', () => {
    expect(splitRow('a\tb\tc', '\t')).toEqual(['a', 'b', 'c'])
  })
})

describe('parseDelimited', () => {
  it('splits rows on either line ending', () => {
    expect(parseDelimited('a,b\r\nc,d\ne,f', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ])
  })

  it('does not invent a row for a trailing newline', () => {
    expect(parseDelimited('a,b\n', ',')).toEqual([['a', 'b']])
  })

  it('keeps a newline inside quotes as part of the cell', () => {
    // The case that decides the whole quoting story: an address with a line
    // break in it must stay one row.
    expect(parseDelimited('a,"上海市\n浦东新区",c', ',')).toEqual([['a', '上海市\n浦东新区', 'c']])
  })

  it('normalises a quoted CRLF to a plain newline', () => {
    expect(parseDelimited('a,"x\r\ny"', ',')).toEqual([['a', 'x\ny']])
  })

  it('preserves leading zeros, because everything is text', () => {
    // `007` becoming `7` is data loss discovered on a printed label.
    expect(parseDelimited('code\n007', ',')).toEqual([['code'], ['007']])
  })

  it('preserves a value a spreadsheet would turn into a date', () => {
    expect(parseDelimited('d\n2024-01-05', ',')[1]).toEqual(['2024-01-05'])
  })

  it('preserves scientific notation as written', () => {
    expect(parseDelimited('n\n1E5', ',')[1]).toEqual(['1E5'])
  })

  it('strips a BOM, which would otherwise join the first column name', () => {
    expect(parseDelimited('﻿订单号,收件人\nA,B', ',')[0]).toEqual(['订单号', '收件人'])
  })

  it('returns nothing for empty input', () => {
    expect(parseDelimited('', ',')).toEqual([])
  })
})

describe('detectDelimiter', () => {
  it('picks the one that appears most in the header row', () => {
    expect(detectDelimiter('订单号;收件人;数量\nB-001;张三;5')).toBe(';')
    expect(detectDelimiter('订单号,收件人\nA-001,张三')).toBe(',')
    expect(detectDelimiter('订单号\t收件人\nA-001\t张三')).toBe('\t')
  })

  it('ignores delimiters inside quotes', () => {
    // Otherwise a header like `"单价,含税"` would elect the comma from inside
    // one column name.
    expect(detectDelimiter('"a;b;c;d";x\n1;2')).toBe(';')
  })

  it('counts only the header row, not the data', () => {
    // Data rows can be full of the wrong character — a comma inside an address
    // is very common in a semicolon-delimited export.
    expect(detectDelimiter('a;b\n"x,y,z,w";q')).toBe(';')
  })

  it('falls back to the comma when the header has no delimiter at all', () => {
    // A single-column file is legitimate; the header check downstream says so
    // if it is not.
    expect(detectDelimiter('订单号\nA-001')).toBe(',')
  })
})
