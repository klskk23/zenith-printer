/**
 * The row envelope, which two opposite paths share.
 *
 * Both the HTTP data source (which fetches one) and the print preset (which is
 * handed one) parse through here, so a rule relaxed for one is relaxed for the
 * other — which is the point of there being one schema rather than two.
 *
 * The rules worth their own tests are the ones whose failure is silent: a row
 * missing a key prints a blank where a value belongs, and a value that is not a
 * string means somebody upstream let a number through and `08` is about to
 * become `8` on a barcode.
 */
import { describe, expect, it } from 'vitest'
import { declaredTotal, nextOffset, rowEnvelopeSchema } from '../src/rows/envelope.ts'

const envelope = (over: Record<string, unknown> = {}) => ({
  columns: ['mac', 'sn'],
  rows: [{ mac: '001A2B3C4D5E', sn: '112394521950' }],
  ...over,
})

const parse = (value: unknown) => rowEnvelopeSchema.safeParse(value)

describe('the shape', () => {
  it('accepts a well-formed envelope', () => {
    expect(parse(envelope()).success).toBe(true)
  })

  it('accepts an envelope carrying no rows at all', () => {
    // "Nothing matched your filter" is an answer, not a fault.
    expect(parse(envelope({ rows: [] })).success).toBe(true)
  })

  it('keeps the declared column order', () => {
    // `columns` is the authority on order; a row object's key order is not.
    const result = rowEnvelopeSchema.parse(envelope({ columns: ['sn', 'mac'] }))
    expect(result.columns).toEqual(['sn', 'mac'])
  })

  it('takes column names in any script', () => {
    const result = parse({ columns: ['收件人'], rows: [{ 收件人: '张三' }] })
    expect(result.success).toBe(true)
  })

  it('gives no meaning to any prefix', () => {
    // A producer may namespace its columns; that is its business, not ours.
    const result = parse({ columns: ['sys_id', 'sys_sn'], rows: [{ sys_id: '1', sys_sn: '2' }] })
    expect(result.success).toBe(true)
  })
})

describe('what it refuses', () => {
  it('a row missing one of the declared columns', () => {
    // The failure this prevents is a blank on a label, which nobody sees until
    // the labels are in their hands.
    const result = parse(envelope({ rows: [{ mac: '001A' }] }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('missing sn')
  })

  it('a row carrying a column that was not declared', () => {
    const result = parse(envelope({ rows: [{ mac: '001A', sn: '11', extra: 'x' }] }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('unexpected extra')
  })

  it('and says which row, not just that one was wrong', () => {
    const result = parse(
      envelope({ rows: [{ mac: 'a', sn: 'b' }, { mac: 'c', sn: 'd' }, { mac: 'e' }] }),
    )
    expect(result.error?.issues[0]?.path).toEqual(['rows', 2])
  })

  it('a value that is not a string', () => {
    // 08 arriving as the number 8 is a barcode that scans as something else.
    expect(parse(envelope({ rows: [{ mac: 'a', sn: 112394521950 }] })).success).toBe(false)
    expect(parse(envelope({ rows: [{ mac: 'a', sn: null }] })).success).toBe(false)
    expect(parse(envelope({ rows: [{ mac: 'a', sn: true }] })).success).toBe(false)
  })

  it('duplicate column names', () => {
    expect(parse(envelope({ columns: ['mac', 'mac'] })).success).toBe(false)
  })

  it('a column name that would close a reference', () => {
    expect(parse({ columns: ['a}b'], rows: [{ 'a}b': 'x' }] }).success).toBe(false)
  })

  it('no columns at all', () => {
    expect(parse(envelope({ columns: [] })).success).toBe(false)
  })
})

describe('paging', () => {
  it('treats an absent total as "this is all of it"', () => {
    // The pushed case: whoever handed this over is not paging.
    expect(declaredTotal(rowEnvelopeSchema.parse(envelope()))).toBe(1)
  })

  it('asks for more while fewer than the total have been fetched', () => {
    const page = rowEnvelopeSchema.parse(envelope({ total: 30, offset: 0, limit: 1 }))
    expect(nextOffset(page, 1)).toBe(1)
  })

  it('stops once the total has been reached', () => {
    const page = rowEnvelopeSchema.parse(envelope({ total: 1 }))
    expect(nextOffset(page, 1)).toBeNull()
  })

  it('stops on an empty page whatever the total claims', () => {
    // A producer whose `total` outruns its rows would otherwise loop forever,
    // asking for an offset it has nothing to put at.
    const page = rowEnvelopeSchema.parse(envelope({ rows: [], total: 900 }))
    expect(nextOffset(page, 0)).toBeNull()
  })
})
