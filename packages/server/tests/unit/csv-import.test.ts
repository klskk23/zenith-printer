import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CsvDuplicateColumnError,
  CsvNoHeaderError,
  CsvTooManyRowsError,
  importCsv,
} from '../../src/csv/import.ts'
import { DecodeFailedError, decodeCsv } from '../../src/csv/encoding.ts'

/**
 * CSV import, against real bytes.
 *
 * The fixtures are files rather than hand-written strings on purpose: the three
 * failures this guards against — `007` becoming `7`, Chinese becoming mojibake,
 * and a whole row landing in one column — only reproduce with real encodings
 * and real separators.
 */
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/csv')
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fixtures, name)))

describe('encoding', () => {
  it('reads a UTF-8 file', () => {
    expect(decodeCsv(bytes('utf8-leading-zeros.csv')).encoding).toBe('utf-8')
  })

  it('reads a GBK file that Chinese Excel produced', () => {
    // Read as UTF-8 this is a screenful of mojibake — obviously wrong, and no
    // clue what to do about it.
    const result = decodeCsv(bytes('gbk-semicolon.csv'))
    expect(result.encoding).toBe('gb18030')
    expect(result.text).toContain('收件人')
    expect(result.text).toContain('张三')
  })

  it('honours an encoding the user asked for', () => {
    expect(decodeCsv(bytes('utf8-leading-zeros.csv'), 'utf-8').encoding).toBe('utf-8')
  })

  it('reports what it tried when nothing decodes', () => {
    // An unpaired surrogate byte sequence no candidate accepts.
    const invalid = new Uint8Array([0xff, 0xfe, 0xff, 0xfe])
    try {
      decodeCsv(invalid, 'utf-8')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DecodeFailedError)
      expect((err as DecodeFailedError).tried).toEqual(['utf-8'])
    }
  })
})

describe('importing', () => {
  it('takes column names from the header row', () => {
    expect(importCsv(bytes('utf8-leading-zeros.csv')).columns).toEqual(['订单号', '收件人', '数量'])
  })

  it('keeps a leading zero', () => {
    // The single most consequential assertion in this file. `007` becoming `7`
    // is not caught until somebody reads a printed label.
    const table = importCsv(bytes('utf8-leading-zeros.csv'))
    expect(table.rows[0]?.数量).toBe('007')
  })

  it('keeps a long digit string exactly, not as a rounded number', () => {
    const table = importCsv(bytes('utf8-leading-zeros.csv'))
    expect(table.rows[2]?.数量).toBe('0012345678901234')
  })

  it('detects a semicolon separator, which Chinese Excel exports', () => {
    // Guessing the comma here puts the whole row into one column, and the
    // symptom — one very wide column — reads as a rendering fault.
    const table = importCsv(bytes('gbk-semicolon.csv'))
    expect(table.delimiter).toBe(';')
    expect(table.columns).toEqual(['订单号', '收件人', '数量'])
    expect(table.rows[0]).toEqual({ 订单号: 'B-001', 收件人: '张三', 数量: '5' })
  })

  it('keeps a quoted newline inside one cell', () => {
    const table = importCsv(bytes('quoted-newline.csv'))
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.地址).toBe('上海市\n浦东新区')
  })

  it('unescapes doubled quotes and keeps a quoted comma', () => {
    const table = importCsv(bytes('quoted-newline.csv'))
    expect(table.rows[0]?.备注).toBe('含,逗号与"引号"')
  })

  it('refuses a header with a blank column name', () => {
    // A column with no name cannot be referenced by `${列名}`.
    expect(() => importCsv(bytes('blank-column-name.csv'))).toThrow(CsvNoHeaderError)
  })

  it('refuses duplicate column names and says which', () => {
    try {
      importCsv(bytes('duplicate-columns.csv'))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CsvDuplicateColumnError)
      expect((err as CsvDuplicateColumnError).columns).toEqual(['订单号'])
    }
  })

  it('refuses a file with more rows than one data source may hold', () => {
    const many = ['code', ...Array.from({ length: 10_001 }, (_unused, i) => String(i))].join('\n')
    try {
      importCsv(new TextEncoder().encode(many))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CsvTooManyRowsError)
      expect(err).toMatchObject({ rowCount: 10_001, maxRows: 10_000 })
    }
  })

  it('accepts a file sitting exactly on the limit', () => {
    const exact = ['code', ...Array.from({ length: 10_000 }, (_unused, i) => String(i))].join('\n')
    expect(importCsv(new TextEncoder().encode(exact)).rows).toHaveLength(10_000)
  })

  it('accepts a header with no data rows', () => {
    // An empty table is a legitimate thing to create and fill in afterwards.
    const table = importCsv(new TextEncoder().encode('订单号,收件人'))
    expect(table.columns).toEqual(['订单号', '收件人'])
    expect(table.rows).toEqual([])
  })

  it('pads a short row rather than rejecting the file', () => {
    // A stray trailing comma somewhere in a thousand-row export should not
    // cost the whole import.
    const table = importCsv(new TextEncoder().encode('a,b,c\n1,2'))
    expect(table.rows[0]).toEqual({ a: '1', b: '2', c: '' })
  })

  it('truncates a long row to the columns the header declares', () => {
    const table = importCsv(new TextEncoder().encode('a,b\n1,2,3'))
    expect(table.rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('trims whitespace around column names, which references would never match', () => {
    const table = importCsv(new TextEncoder().encode('  订单号 , 收件人\nA,B'))
    expect(table.columns).toEqual(['订单号', '收件人'])
  })

  it('lets the user override a mis-detected separator', () => {
    // Detection is best-effort; the escape hatch is what makes that acceptable.
    const table = importCsv(new TextEncoder().encode('a;b\n1;2'), { delimiter: ',' })
    expect(table.columns).toEqual(['a;b'])
  })
})
