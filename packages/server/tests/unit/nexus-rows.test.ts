/**
 * Fetching a category's rows from the asset ledger.
 *
 * Everything here runs against a fake port, which is the point of there being
 * one: the default suite has no network and stands up no ledger, so a test can
 * describe one that pages badly, changes its mind, or lies about its total, and
 * none of that requires anybody to build such a ledger.
 *
 * The failures worth their own tests are the ones with no natural end: paging
 * that never advances, and a total that outruns the rows. Both spin forever
 * rather than erroring, and a spin inside a refresh is a page that never loads
 * with nothing in the log to say why.
 */
import { describe, expect, it } from 'vitest'
import { rowEnvelopeSchema } from '@zenith/shared'
import {
  NEXUS_KEY_COLUMN,
  NexusError,
  fetchCategoryRows,
  parseRowEnvelope,
  type NexusPort,
} from '../../src/domain/nexus.ts'

const COLUMNS = ['sys_id', 'sys_sn', 'mac']
const row = (id: string) => ({ sys_id: id, sys_sn: `SN-${id}`, mac: `MAC-${id}` })

const envelope = (ids: string[], over: Record<string, unknown> = {}) =>
  rowEnvelopeSchema.parse({ columns: COLUMNS, rows: ids.map(row), ...over })

/** A ledger that answers from a script, recording what it was asked. */
function port(pages: Array<ReturnType<typeof envelope>>): NexusPort & {
  asked: Array<{ categoryId: string; offset: number; limit: number; locale: string }>
} {
  const asked: Array<{ categoryId: string; offset: number; limit: number; locale: string }> = []
  return {
    asked,
    categories: () => Promise.resolve([]),
    rows(request) {
      asked.push(request)
      const next = pages.shift()
      if (next === undefined) {
        throw new Error('asked for more pages than the script has')
      }
      return Promise.resolve(next)
    },
  }
}

const fetchAll = (p: NexusPort, limit = 10_000) => fetchCategoryRows(p, 'cat-1', 'zh-CN', limit)

describe('one page', () => {
  it('returns the columns and rows as given', async () => {
    const result = await fetchAll(port([envelope(['a', 'b'])]))
    expect(result.columns).toEqual(COLUMNS)
    expect(result.rows.map((r) => r.sys_id)).toEqual(['a', 'b'])
  })

  it('asks for the category, its descendants included', async () => {
    const p = port([envelope(['a'])])
    await fetchAll(p)
    expect(p.asked[0]).toMatchObject({ categoryId: 'cat-1', offset: 0 })
  })

  it('passes the language through', async () => {
    // The ledger renders its own dates and booleans into words, and those
    // words end up on a label.
    const p = port([envelope(['a'])])
    await fetchAll(p)
    expect(p.asked[0]?.locale).toBe('zh-CN')
  })

  it('accepts a category with nothing in it', async () => {
    expect((await fetchAll(port([envelope([])]))).rows).toEqual([])
  })
})

describe('paging', () => {
  it('follows the ledger until the total is reached', async () => {
    const p = port([
      envelope(['a', 'b'], { total: 5, offset: 0, limit: 2 }),
      envelope(['c', 'd'], { total: 5, offset: 2, limit: 2 }),
      envelope(['e'], { total: 5, offset: 4, limit: 2 }),
    ])
    const result = await fetchAll(p)
    expect(result.rows.map((r) => r.sys_id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('advances the offset by what it has actually collected', async () => {
    const p = port([envelope(['a'], { total: 2 }), envelope(['b'], { total: 2 })])
    await fetchAll(p)
    expect(p.asked.map((request) => request.offset)).toEqual([0, 1])
  })

  it('stops on an empty page whatever the total claims', async () => {
    // Otherwise this asks forever for an offset the ledger has nothing at.
    const p = port([envelope(['a'], { total: 900 }), envelope([], { total: 900 })])
    expect((await fetchAll(p)).rows).toHaveLength(1)
  })

  it('refuses a ledger that changes its columns mid-read', async () => {
    const p = port([
      envelope(['a'], { total: 2 }),
      rowEnvelopeSchema.parse({ columns: ['sys_id'], rows: [{ sys_id: 'b' }], total: 2 }),
    ])
    await expect(fetchAll(p)).rejects.toMatchObject({ kind: 'badShape' })
  })
})

describe('the row ceiling', () => {
  it('refuses on the declared total before paging through it', async () => {
    // One request, not a hundred: refusing at the end means having already
    // pulled it all into memory to find out it was too much.
    const p = port([envelope(['a'], { total: 50_000 })])
    await expect(fetchAll(p, 10)).rejects.toMatchObject({ kind: 'tooManyRows' })
    expect(p.asked).toHaveLength(1)
  })

  it('refuses when the rows outrun the ceiling even if the total lied', async () => {
    await expect(fetchAll(port([envelope(['a', 'b', 'c'])]), 2)).rejects.toMatchObject({
      kind: 'tooManyRows',
    })
  })
})

describe('reading a body', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseRowEnvelope({ columns: ['sys_id'], rows: [{ sys_id: 'a' }] }).rows).toHaveLength(1)
  })

  it('says where the shape went wrong, not merely that it did', () => {
    // Whoever maintains the ledger has to be able to fix it; "bad shape" is
    // not a repair.
    try {
      parseRowEnvelope({ columns: ['sys_id', 'mac'], rows: [{ sys_id: 'a' }] })
      expect.unreachable()
    } catch (err) {
      expect((err as NexusError).kind).toBe('badShape')
      expect((err as NexusError).detail).toContain('rows.0')
      expect((err as NexusError).detail).toContain('missing mac')
    }
  })

  it('refuses a body that is not an envelope at all', () => {
    expect(() => parseRowEnvelope({ hello: 'world' })).toThrow(NexusError)
    expect(() => parseRowEnvelope(undefined)).toThrow(NexusError)
  })
})

describe('the key column', () => {
  it('is the ledger own device id, and is not a choice', () => {
    // Offering the choice would be offering somebody the chance to pick a
    // column that is not stable, and rows shifting under a selection already
    // made is a silent failure.
    expect(NEXUS_KEY_COLUMN).toBe('sys_id')
  })
})
