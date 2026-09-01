/**
 * Fetching rows from a producer over HTTP.
 *
 * Everything here runs against a fake port, which is the point of there being
 * one: the default suite has no network and stands up no server, so a test can
 * describe a producer that pages badly, changes its mind, or lies about its
 * total, and none of that requires anybody to write such a producer.
 *
 * The failures worth their own tests are the ones with no natural end: a
 * producer whose offset never advances, and one whose total outruns its rows.
 * Both spin forever rather than erroring, and a spin in a refresh is a page
 * that never loads with nothing in the log to say why.
 */
import { describe, expect, it } from 'vitest'
import {
  HttpSourceError,
  fetchAllRows,
  pageUrl,
  type HttpRowsPort,
  type HttpRowsRequest,
  type HttpRowsResponse,
} from '../../src/domain/http-rows.ts'

/** A producer that answers from a script, recording what it was asked. */
function port(pages: HttpRowsResponse[]): HttpRowsPort & { asked: HttpRowsRequest[] } {
  const asked: HttpRowsRequest[] = []
  return {
    asked,
    get(request) {
      asked.push(request)
      const next = pages.shift()
      if (next === undefined) {
        throw new Error('asked for more pages than the script has')
      }
      return Promise.resolve(next)
    },
  }
}

const ok = (body: unknown): HttpRowsResponse => ({ status: 200, body })

const page = (ids: string[], over: Record<string, unknown> = {}) => ({
  columns: ['sys_id', 'name'],
  rows: ids.map((id) => ({ sys_id: id, name: `名字-${id}` })),
  ...over,
})

const request = { url: 'http://producer.invalid/rows?category=1', headers: {} }

describe('one page', () => {
  it('returns the columns and rows as given', async () => {
    const result = await fetchAllRows(port([ok(page(['a', 'b']))]), request)
    expect(result.columns).toEqual(['sys_id', 'name'])
    expect(result.rows.map((row) => row.sys_id)).toEqual(['a', 'b'])
  })

  it('sends the headers it was configured with', async () => {
    const p = port([ok(page(['a']))])
    await fetchAllRows(p, { url: request.url, headers: { Authorization: 'Bearer k' } })
    expect(p.asked[0]?.headers).toEqual({ Authorization: 'Bearer k' })
  })

  it('asks for the configured URL untouched', async () => {
    // It may already carry the producer's own filters; rewriting it would be
    // this system deciding what the other end's query means.
    const p = port([ok(page(['a']))])
    await fetchAllRows(p, request)
    expect(p.asked[0]?.url).toBe('http://producer.invalid/rows?category=1')
  })

  it('accepts an empty table', async () => {
    const result = await fetchAllRows(port([ok(page([]))]), request)
    expect(result.rows).toEqual([])
  })
})

describe('paging', () => {
  it('follows the producer until the total is reached', async () => {
    const p = port([
      ok(page(['a', 'b'], { total: 5, offset: 0, limit: 2 })),
      ok(page(['c', 'd'], { total: 5, offset: 2, limit: 2 })),
      ok(page(['e'], { total: 5, offset: 4, limit: 2 })),
    ])
    const result = await fetchAllRows(p, request)
    expect(result.rows.map((row) => row.sys_id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('asks for the next page by offset, keeping the original query', async () => {
    const p = port([
      ok(page(['a'], { total: 2, limit: 1 })),
      ok(page(['b'], { total: 2, limit: 1 })),
    ])
    await fetchAllRows(p, request)
    expect(p.asked[1]?.url).toBe('http://producer.invalid/rows?category=1&offset=1')
  })

  it('stops when a page comes back empty, whatever the total claims', async () => {
    // Otherwise this asks forever for an offset the producer has nothing at.
    const p = port([ok(page(['a'], { total: 900 })), ok(page([], { total: 900 }))])
    const result = await fetchAllRows(p, request)
    expect(result.rows).toHaveLength(1)
  })

  it('refuses a producer whose paging does not advance', async () => {
    // Same page forever: rows arrive, the count never reaches the total, and
    // without this the refresh spins with nothing in the log to say why.
    const p = port([
      ok(page(['a'], { total: 9 })),
      ok(page(['a'], { total: 9 })),
      ok(page(['a'], { total: 9 })),
    ])
    await expect(fetchAllRows(p, request)).rejects.toThrow(HttpSourceError)
  })

  it('refuses a producer that changes its columns mid-read', async () => {
    const p = port([
      ok(page(['a'], { total: 2, limit: 1 })),
      ok({ columns: ['sys_id'], rows: [{ sys_id: 'b' }], total: 2, limit: 1 }),
    ])
    await expect(fetchAllRows(p, request)).rejects.toMatchObject({ kind: 'badShape' })
  })
})

describe('the row ceiling', () => {
  it('refuses on the declared total before paging through it', async () => {
    // One request, not a hundred: refusing at the end means having already
    // pulled it all into memory to find out it was too much.
    const p = port([ok(page(['a'], { total: 50_000 }))])
    await expect(fetchAllRows(p, request, 10)).rejects.toMatchObject({ kind: 'tooManyRows' })
    expect(p.asked).toHaveLength(1)
  })

  it('refuses when the rows outrun the ceiling even if the total lied', async () => {
    const p = port([ok(page(['a', 'b', 'c']))])
    await expect(fetchAllRows(p, request, 2)).rejects.toMatchObject({ kind: 'tooManyRows' })
  })
})

describe('what it refuses', () => {
  it('a producer that cannot be reached', async () => {
    const failing: HttpRowsPort = { get: () => Promise.reject(new Error('ECONNREFUSED')) }
    await expect(fetchAllRows(failing, request)).rejects.toMatchObject({ kind: 'unreachable' })
  })

  it('a non-2xx answer, keeping the status', async () => {
    // 401 and 503 need different sentences: one is the credential, one is them.
    const p = port([{ status: 401, body: { error: 'nope' } }])
    await expect(fetchAllRows(p, request)).rejects.toMatchObject({ kind: 'badStatus', status: 401 })
  })

  it('a body that is not a row envelope', async () => {
    await expect(fetchAllRows(port([ok({ hello: 'world' })]), request)).rejects.toMatchObject({
      kind: 'badShape',
    })
  })

  it('a body that is not JSON at all', async () => {
    await expect(fetchAllRows(port([ok(undefined)]), request)).rejects.toMatchObject({
      kind: 'badShape',
    })
  })

  it('says where the shape went wrong, not merely that it did', async () => {
    // The other end has to be able to fix it; "bad shape" is not a repair.
    const p = port([ok({ columns: ['sys_id', 'name'], rows: [{ sys_id: 'a' }] })])
    try {
      await fetchAllRows(p, request)
      expect.unreachable()
    } catch (err) {
      expect((err as HttpSourceError).detail).toContain('rows.0')
      expect((err as HttpSourceError).detail).toContain('missing name')
    }
  })
})

describe('pageUrl', () => {
  it('leaves the first page alone', () => {
    expect(pageUrl('http://x.invalid/r?a=1', 0)).toBe('http://x.invalid/r?a=1')
  })

  it('adds an offset without disturbing the existing query', () => {
    expect(pageUrl('http://x.invalid/r?a=1', 20)).toBe('http://x.invalid/r?a=1&offset=20')
  })

  it('replaces an offset the URL already carried', () => {
    expect(pageUrl('http://x.invalid/r?offset=5', 20)).toBe('http://x.invalid/r?offset=20')
  })
})
