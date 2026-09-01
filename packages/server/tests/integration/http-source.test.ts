/**
 * A data source that reads its rows from an address.
 *
 * Driven through the real routes against a fake port, so the default suite
 * needs no network and no producer to stand up.
 *
 * The property the whole thing exists for is in "identity survives a refresh":
 * a row chosen before the producer changed underneath still means that row
 * afterwards. Under the model this replaces it did not, and nothing said so —
 * ordinals shifted, the selection still named ordinals that existed, and the
 * wrong labels came out of the printer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import type { HttpRowsPort, HttpRowsRequest, HttpRowsResponse } from '../../src/domain/http-rows.ts'

let app: FastifyInstance
let answer: (request: HttpRowsRequest) => HttpRowsResponse
let asked: HttpRowsRequest[]

const COLUMNS = ['sys_id', 'sys_sn', '名称']
const row = (id: string, over: Record<string, string> = {}) => ({
  sys_id: id,
  sys_sn: `SN-${id}`,
  名称: `设备-${id}`,
  ...over,
})
const table = (ids: string[], over: Record<string, unknown> = {}) => ({
  columns: COLUMNS,
  rows: ids.map((id) => row(id)),
  ...over,
})

const port: HttpRowsPort = {
  get(request) {
    asked.push(request)
    return Promise.resolve(answer(request))
  },
}

beforeEach(async () => {
  asked = []
  answer = () => ({ status: 200, body: table(['a', 'b', 'c']) })
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-09-01T12:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    httpRows: port,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const create = (over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/data-sources/http',
    payload: {
      name: '设备表',
      url: 'http://producer.invalid/rows?category=1',
      keyColumn: 'sys_id',
      headers: { Authorization: 'Bearer nxk_secret' },
      ...over,
    },
  })

const refresh = (id: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload })

const rowsOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=50` })).json()

/** There is no GET /:id in this service — the list is where a source is read. */
const sourceOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources.find(
    (source: { id: string }) => source.id === id,
  )

async function created(over: Record<string, unknown> = {}): Promise<string> {
  return (await create(over)).json().id as string
}

describe('creating one', () => {
  it('is created empty, and says so', async () => {
    // Creating and reading are separate acts: a producer that is down must not
    // stop the table being made.
    const res = await create()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sourceKind: 'http', rowCount: 0, lastRefreshedAt: null })
    expect(asked).toHaveLength(0)
  })

  it('never returns the header values, on any endpoint', async () => {
    // The credential belongs to somebody else's system, and this one has no
    // authentication of its own.
    const id = await created()
    const list = (await app.inject({ method: 'GET', url: '/api/data-sources' })).body
    expect(list).not.toContain('nxk_secret')
    expect((await create({ name: '另一张' })).body).not.toContain('nxk_secret')
    expect(id).toBeDefined()
  })

  it('shows that a header is configured, without showing what it says', async () => {
    const id = await created()
    expect((await sourceOf(id)).http.headerNames).toEqual(['Authorization'])
  })

  it('refuses a name already in use', async () => {
    await created()
    expect((await create()).statusCode).toBe(409)
  })

  it('refuses an address that is not http', async () => {
    expect((await create({ url: 'file:///etc/passwd' })).statusCode).toBe(400)
  })

  it('requires a key column', async () => {
    expect((await create({ keyColumn: undefined })).statusCode).toBe(400)
  })

  it('defaults to refreshing only when asked', async () => {
    // Exactly what this product did before there was another option.
    const body = (await create()).json()
    expect(body).toMatchObject({ refreshIntervalSeconds: 0, refreshBeforePrint: false })
  })
})

describe('refreshing', () => {
  it('fetches with the configured address and headers', async () => {
    const id = await created()
    await refresh(id)
    expect(asked[0]?.url).toBe('http://producer.invalid/rows?category=1')
    expect(asked[0]?.headers).toMatchObject({ Authorization: 'Bearer nxk_secret' })
  })

  it('stores the rows, with the producer as the authority on columns', async () => {
    const id = await created()
    const res = await refresh(id)
    expect(res.json()).toMatchObject({ outcome: 'applied', rowsBefore: 0, rowsAfter: 3, added: 3 })

    expect((await sourceOf(id)).columns).toEqual(COLUMNS)
    const listed = await rowsOf(id)
    expect(listed.rows.map((r: { values: Record<string, string> }) => r.values.sys_id)).toEqual(['a', 'b', 'c'])
  })

  it('says what the merge did, not only that it happened', async () => {
    // "Applied" alone cannot tell a refresh that changed nothing from one that
    // replaced the table.
    const id = await created()
    await refresh(id)
    answer = () => ({ status: 200, body: table(['a', 'c', 'd']) })
    expect((await refresh(id)).json()).toMatchObject({ added: 1, removed: 1, updated: 0 })
  })

  it('follows the producer across pages', async () => {
    const id = await created()
    answer = (request) =>
      request.url.includes('offset=2')
        ? { status: 200, body: table(['c'], { total: 3, offset: 2, limit: 2 }) }
        : { status: 200, body: table(['a', 'b'], { total: 3, offset: 0, limit: 2 }) }

    expect((await refresh(id)).json()).toMatchObject({ rowsAfter: 3 })
  })

  it('refuses a source that reads from nowhere', async () => {
    const local = (
      await app.inject({
        method: 'POST',
        url: '/api/data-sources/http',
        payload: { name: '另一张', url: 'http://x.invalid/r', keyColumn: 'sys_id' },
      })
    ).json().id as string
    await app.inject({ method: 'POST', url: `/api/data-sources/${local}/unlink`, payload: { confirmed: true } })
    expect((await refresh(local)).statusCode).toBe(422)
  })
})

describe('identity survives a refresh', () => {
  it('keeps a chosen row meaning that row when the producer inserts above it', async () => {
    // The purchase the key column was made for.
    const id = await created()
    await refresh(id)
    const before = (await rowsOf(id)).rows.find(
      (r: { values: Record<string, string> }) => r.values.sys_id === 'c',
    )

    answer = () => ({ status: 200, body: table(['a', 'inserted', 'b', 'c']) })
    await refresh(id)

    const after = (await rowsOf(id)).rows.find(
      (r: { ordinal: number }) => r.ordinal === before.ordinal,
    )
    expect(after.values.sys_id).toBe('c')
  })

  it('puts a new row at the end rather than reshuffling the table', async () => {
    const id = await created()
    await refresh(id)
    answer = () => ({ status: 200, body: table(['inserted', 'a', 'b', 'c']) })
    await refresh(id)

    const order = (await rowsOf(id)).rows.map((r: { values: Record<string, string> }) => r.values.sys_id)
    expect(order).toEqual(['a', 'b', 'c', 'inserted'])
  })

  it('takes the new values for a row that stayed', async () => {
    const id = await created()
    await refresh(id)
    answer = () => ({
      status: 200,
      body: { columns: COLUMNS, rows: [row('a', { 名称: '改名了' })] },
    })
    await refresh(id)

    const rows = (await rowsOf(id)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].values.名称).toBe('改名了')
  })
})

describe('what a refresh refuses', () => {
  const failsWith = async (code: string, respond: () => HttpRowsResponse) => {
    const id = await created()
    await refresh(id)
    answer = respond
    const res = await refresh(id)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe(code)
    return id
  }

  it('a producer that cannot be reached — and keeps the rows that are here', async () => {
    const id = await created()
    await refresh(id)
    answer = () => {
      throw new Error('ECONNREFUSED')
    }
    const res = await refresh(id)
    expect(res.json().code).toBe('HTTP_SOURCE_UNREACHABLE')
    // Printing must not stop because somebody else's system is down.
    expect((await rowsOf(id)).rows).toHaveLength(3)
  })

  it('a non-2xx answer', async () => {
    await failsWith('HTTP_SOURCE_BAD_STATUS', () => ({ status: 401, body: { error: 'nope' } }))
  })

  it('a body that is not a table', async () => {
    await failsWith('HTTP_SOURCE_BAD_SHAPE', () => ({ status: 200, body: { hello: 'world' } }))
  })

  it('two rows sharing a key, naming the values', async () => {
    const id = await failsWith('HTTP_SOURCE_DUPLICATE_KEY', () => ({
      status: 200,
      body: { columns: COLUMNS, rows: [row('a'), row('b'), row('a')] },
    }))
    const res = await refresh(id)
    expect(res.json().details.duplicates).toEqual(['a'])
  })

  it('a row with an empty key', async () => {
    await failsWith('HTTP_SOURCE_MISSING_KEY', () => ({
      status: 200,
      body: { columns: COLUMNS, rows: [row('a'), { ...row('b'), sys_id: '' }] },
    }))
  })

  it('a producer that stopped sending the key column at all', async () => {
    // Going ahead would rebuild the table by position again, silently.
    await failsWith('HTTP_SOURCE_MISSING_KEY', () => ({
      status: 200,
      body: { columns: ['sys_sn', '名称'], rows: [{ sys_sn: 'SN-a', 名称: '设备-a' }] },
    }))
  })

  it('the three-part copy, since the other system shows it to a person', async () => {
    const id = await created()
    answer = () => ({ status: 503, body: {} })
    const body = (await refresh(id)).json()
    for (const field of ['code', 'what', 'why', 'next']) {
      expect(typeof body[field]).toBe('string')
    }
  })
})

describe('a column disappearing', () => {
  it('is refused until confirmed, the same as for a spreadsheet', async () => {
    const id = await created()
    await refresh(id)

    answer = () => ({ status: 200, body: { columns: ['sys_id', 'sys_sn'], rows: [{ sys_id: 'a', sys_sn: 'SN-a' }] } })
    const res = await refresh(id)
    expect(res.json()).toMatchObject({ outcome: 'needsConfirmation', removedColumns: ['名称'] })

    // And the table is untouched until it is.
    expect((await rowsOf(id)).rows).toHaveLength(3)
  })

  it('goes through once confirmed', async () => {
    const id = await created()
    await refresh(id)
    answer = () => ({ status: 200, body: { columns: ['sys_id', 'sys_sn'], rows: [{ sys_id: 'a', sys_sn: 'SN-a' }] } })
    expect((await refresh(id, { confirmColumnChange: true })).json()).toMatchObject({ outcome: 'applied' })
  })

  it('lets a new column through without asking', async () => {
    const id = await created()
    await refresh(id)
    answer = () => ({
      status: 200,
      body: { columns: [...COLUMNS, 'firmware'], rows: [{ ...row('a'), firmware: '2.1.3' }] },
    })
    expect((await refresh(id)).json()).toMatchObject({ outcome: 'applied', columnsAdded: ['firmware'] })
  })
})

describe('releasing it', () => {
  it('keeps the rows and forgets the address and the credential', async () => {
    const id = await created()
    await refresh(id)
    const res = await app.inject({
      method: 'POST',
      url: `/api/data-sources/${id}/unlink`,
      payload: { confirmed: true },
    })
    expect(res.json()).toMatchObject({ sourceKind: 'local', rowCount: 3 })
    expect(res.json().http ?? null).toBeNull()
  })
})

describe('changing how it reads', () => {
  it('leaves the stored credential alone when none is sent', async () => {
    // The caller cannot read it back, so requiring them to resend it would be
    // requiring them to know it.
    const id = await created()
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/http`,
      payload: { refreshIntervalSeconds: 300 },
    })
    await refresh(id)
    expect(asked[0]?.headers).toMatchObject({ Authorization: 'Bearer nxk_secret' })
  })

  it('records how stale the rows may get', async () => {
    const id = await created()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/http`,
      payload: { refreshIntervalSeconds: 300 },
    })
    expect(res.json()).toMatchObject({ refreshIntervalSeconds: 300 })
  })

  it('refuses refresh-before-print on a source with no key column', async () => {
    // Refreshing at submission time would move the rows out from under a
    // selection already made, in the worst possible moment.
    //
    // The state is made directly rather than through the API: a key column is
    // required to create an http source and the schema will not accept an
    // empty one, so this is the guard for a row that got into that state some
    // other way — which the column being nullable keeps possible.
    const id = await created()
    app.ctx.db.prepare('UPDATE data_sources SET key_column = NULL WHERE id = ?').run(id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/http`,
      payload: { refreshBeforePrint: true },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('HTTP_SOURCE_KEY_COLUMN_REQUIRED')
  })

  it('allows it once there is one', async () => {
    const id = await created()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/http`,
      payload: { refreshBeforePrint: true },
    })
    expect(res.json()).toMatchObject({ refreshBeforePrint: true, keyColumn: 'sys_id' })
  })

  it('refuses to configure a source that reads from nowhere', async () => {
    const id = await created()
    await app.inject({ method: 'POST', url: `/api/data-sources/${id}/unlink`, payload: { confirmed: true } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/http`,
      payload: { refreshIntervalSeconds: 60 },
    })
    expect(res.statusCode).toBe(422)
  })
})
