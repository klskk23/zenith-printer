/**
 * A data source backed by a category of the asset ledger.
 *
 * Driven through the real routes against a fake port, so the default suite
 * needs no network and no ledger to stand up.
 *
 * Two properties carry the feature:
 *
 *   - **configuration is one field.** The address, the key and the key column
 *     are decided by the deployment and by what the ledger calls its device id.
 *     None of them is stored, so none of them can drift from the environment it
 *     came from — and none can leak out of an endpoint that has no
 *     authentication of its own.
 *   - **identity survives a refresh.** A row chosen before the ledger changed
 *     underneath still means that row afterwards. Under the model this replaces
 *     it did not, and nothing said so: ordinals shifted, the selection still
 *     named ordinals that existed, and the wrong labels came out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { NexusError, type NexusCategory, type NexusPort } from '../../src/domain/nexus.ts'
import { rowEnvelopeSchema, type RowEnvelope } from '@zenith/shared'

let app: FastifyInstance
let answer: (request: { categoryId: string; offset: number; limit: number }) => RowEnvelope
let categoryAnswer: () => NexusCategory[]
let asked: Array<{ categoryId: string; offset: number; limit: number; locale: string }>

const COLUMNS = ['sys_id', 'sys_sn', 'sys_category', 'mac']
const row = (id: string, over: Record<string, string> = {}) => ({
  sys_id: id,
  sys_sn: `1123945219${id.length}`,
  sys_category: '种子路由器',
  mac: `001A2B3C4D${id.slice(0, 2)}`,
  ...over,
})
const table = (ids: string[], over: Record<string, unknown> = {}) =>
  rowEnvelopeSchema.parse({ columns: COLUMNS, rows: ids.map((id) => row(id)), ...over })

const CATEGORIES: NexusCategory[] = [
  { id: 'cat-router', code: 'SEEDRT', name: '种子路由器', parent_id: 'cat-net', path: '/cat-net/cat-router/', display_key: 'sn' },
  { id: 'cat-net', code: 'NET', name: '网络设备', parent_id: null, path: '/cat-net/' },
]

const port: NexusPort = {
  categories: () => Promise.resolve(categoryAnswer()),
  rows(request) {
    asked.push(request)
    return Promise.resolve(answer(request))
  },
}

/** With the ledger configured, unless a test asks for the other case. */
function start(configured = true): void {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-09-01T12:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    ...(configured ? { nexus: { port, baseUrl: 'http://ledger.invalid' } } : {}),
  })
}

beforeEach(async () => {
  asked = []
  categoryAnswer = () => CATEGORIES
  answer = () => table(['aa', 'bb', 'cc'])
  start()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const create = (payload: Record<string, unknown> = { categoryId: 'cat-router' }) =>
  app.inject({ method: 'POST', url: '/api/data-sources/nexus', payload })

const refresh = (id: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload })

const rowsOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=50` })).json()

const sourceOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources.find(
    (source: { id: string }) => source.id === id,
  )

async function created(payload?: Record<string, unknown>): Promise<string> {
  return (await create(payload)).json().id as string
}

describe('the category list', () => {
  it('is what the dropdown is filled from', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data-sources/nexus/categories' })
    expect(res.json()).toMatchObject({ configured: true })
    expect(res.json().categories).toHaveLength(2)
  })

  it('says "not configured" rather than failing, when it is not', async () => {
    // The page hides the entry point; an error would make it show one that
    // cannot work. Same answer the Google integration gives.
    await app.close()
    start(false)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/data-sources/nexus/categories' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ configured: false, categories: [] })
  })

  it('says which failure it was when the ledger refuses the key', async () => {
    // 401 and "it is down" need different repairs by different people.
    categoryAnswer = () => {
      throw new NexusError('unauthorised', '401')
    }
    const res = await app.inject({ method: 'GET', url: '/api/data-sources/nexus/categories' })
    expect(res.json().code).toBe('NEXUS_UNAUTHORISED')
  })

  it('and when it cannot be reached at all', async () => {
    categoryAnswer = () => {
      throw new NexusError('unreachable', 'ECONNREFUSED')
    }
    expect((await app.inject({ method: 'GET', url: '/api/data-sources/nexus/categories' })).json().code).toBe(
      'NEXUS_UNREACHABLE',
    )
  })

  it('previews the columns of one category, so a design can be written first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/data-sources/nexus/categories/cat-router/columns',
    })
    expect(res.json().columns).toEqual(COLUMNS)
  })
})

describe('connecting one', () => {
  it('needs only a category', async () => {
    const res = await create()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sourceKind: 'nexus', rowCount: 0, lastRefreshedAt: null })
  })

  it('takes the category own name, so nobody has to invent one', async () => {
    expect((await create()).json().name).toBe('种子路由器')
  })

  it('accepts a name when one is given', async () => {
    expect((await create({ categoryId: 'cat-router', name: '我的路由器' })).json().name).toBe('我的路由器')
  })

  it('stores the category and nothing else about the connection', async () => {
    // No address, no key, no key column. What is not held cannot drift from
    // the environment, and cannot leak from an endpoint with no authentication.
    const id = await created()
    const source = await sourceOf(id)
    expect(source.nexus).toEqual({ categoryId: 'cat-router' })
    expect(JSON.stringify(source)).not.toContain('ledger.invalid')
    for (const gone of ['url', 'headers', 'headerNames', 'apiKey']) {
      expect(source[gone]).toBeUndefined()
    }
  })

  it('reports the key column without having stored it', async () => {
    // Derived from the kind: the ledger keys its rows by its own device id.
    expect((await sourceOf(await created())).keyColumn).toBe('sys_id')
  })

  it('fetches nothing yet', async () => {
    // Creating and reading are separate acts: a ledger that is down must not
    // stop the source being made.
    await created()
    expect(asked).toHaveLength(0)
  })

  it('refuses when the ledger is not configured at all', async () => {
    await app.close()
    start(false)
    await app.ready()
    const res = await create()
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('NEXUS_NOT_CONFIGURED')
  })

  it('refuses a name already in use', async () => {
    await created()
    expect((await create()).statusCode).toBe(409)
  })

  it('can also be created by kind on the collection path', async () => {
    // What a caller reaches for. Same code underneath.
    const res = await app.inject({
      method: 'POST',
      url: '/api/data-sources',
      payload: { kind: 'nexus', categoryId: 'cat-net' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ sourceKind: 'nexus', name: '网络设备' })
  })
})

describe('refreshing', () => {
  it('stores the rows, with the ledger as the authority on columns', async () => {
    const id = await created()
    expect((await refresh(id)).json()).toMatchObject({
      outcome: 'applied',
      rowsBefore: 0,
      rowsAfter: 3,
      added: 3,
    })
    expect((await sourceOf(id)).columns).toEqual(COLUMNS)
  })

  it('asks for the category it was connected to, descendants included', async () => {
    const id = await created()
    await refresh(id)
    expect(asked[0]).toMatchObject({ categoryId: 'cat-router', offset: 0 })
  })

  it('says what the merge did, not only that it happened', async () => {
    const id = await created()
    await refresh(id)
    answer = () => table(['aa', 'cc', 'dd'])
    expect((await refresh(id)).json()).toMatchObject({ added: 1, removed: 1, updated: 0 })
  })

  it('follows the ledger across pages', async () => {
    const id = await created()
    answer = (request) =>
      request.offset >= 2
        ? table(['cc'], { total: 3, offset: 2 })
        : table(['aa', 'bb'], { total: 3, offset: 0 })
    expect((await refresh(id)).json()).toMatchObject({ rowsAfter: 3 })
  })
})

describe('identity survives a refresh', () => {
  it('keeps a chosen row meaning that row when the ledger inserts above it', async () => {
    // The whole reason a stable device id is the key.
    const id = await created()
    await refresh(id)
    const before = (await rowsOf(id)).rows.find(
      (r: { values: Record<string, string> }) => r.values.sys_id === 'cc',
    )

    answer = () => table(['aa', 'new', 'bb', 'cc'])
    await refresh(id)

    const after = (await rowsOf(id)).rows.find((r: { ordinal: number }) => r.ordinal === before.ordinal)
    expect(after.values.sys_id).toBe('cc')
  })

  it('puts a new row at the end rather than reshuffling the table', async () => {
    const id = await created()
    await refresh(id)
    answer = () => table(['new', 'aa', 'bb', 'cc'])
    await refresh(id)

    const order = (await rowsOf(id)).rows.map((r: { values: Record<string, string> }) => r.values.sys_id)
    expect(order).toEqual(['aa', 'bb', 'cc', 'new'])
  })

  it('takes the new values for a device that stayed', async () => {
    const id = await created()
    await refresh(id)
    answer = () => rowEnvelopeSchema.parse({ columns: COLUMNS, rows: [row('aa', { mac: 'CHANGED' })] })
    await refresh(id)

    const rows = (await rowsOf(id)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].values.mac).toBe('CHANGED')
  })
})

describe('what a refresh refuses', () => {
  const failsWith = async (code: string, respond: () => RowEnvelope) => {
    const id = await created()
    await refresh(id)
    answer = respond
    const res = await refresh(id)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe(code)
    return id
  }

  it('a ledger that cannot be reached — and keeps the rows that are here', async () => {
    const id = await created()
    await refresh(id)
    answer = () => {
      throw new NexusError('unreachable', 'ECONNREFUSED')
    }
    expect((await refresh(id)).json().code).toBe('NEXUS_UNREACHABLE')
    // Printing must not stop because the ledger is having a bad afternoon.
    expect((await rowsOf(id)).rows).toHaveLength(3)
  })

  it('a key the ledger no longer accepts, said as its own thing', async () => {
    const id = await created()
    answer = () => {
      throw new NexusError('unauthorised', '401')
    }
    expect((await refresh(id)).json().code).toBe('NEXUS_UNAUTHORISED')
  })

  it('a request the ledger could not read', async () => {
    const id = await created()
    answer = () => {
      throw new NexusError('badRequest', '422')
    }
    expect((await refresh(id)).json().code).toBe('NEXUS_BAD_REQUEST')
  })

  it('two devices sharing an id, naming them', async () => {
    const id = await failsWith('NEXUS_DUPLICATE_KEY', () =>
      rowEnvelopeSchema.parse({ columns: COLUMNS, rows: [row('aa'), row('bb'), row('aa')] }),
    )
    expect((await refresh(id)).json().details.duplicates).toEqual(['aa'])
  })

  it('a row with no device id', async () => {
    await failsWith('NEXUS_MISSING_KEY', () =>
      rowEnvelopeSchema.parse({ columns: COLUMNS, rows: [row('aa'), { ...row('bb'), sys_id: '' }] }),
    )
  })

  it('a ledger that stopped sending the device id at all', async () => {
    // Going ahead would rebuild the table by position again, silently.
    await failsWith('NEXUS_MISSING_KEY', () =>
      rowEnvelopeSchema.parse({ columns: ['sys_sn', 'mac'], rows: [{ sys_sn: '1', mac: '2' }] }),
    )
  })

  it('the three-part copy, since the ledger shows it to a person', async () => {
    const id = await created()
    answer = () => {
      throw new NexusError('unreachable', 'down')
    }
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
    answer = () =>
      rowEnvelopeSchema.parse({ columns: ['sys_id', 'sys_sn'], rows: [{ sys_id: 'aa', sys_sn: '1' }] })

    expect((await refresh(id)).json()).toMatchObject({ outcome: 'needsConfirmation' })
    expect((await rowsOf(id)).rows).toHaveLength(3)
  })

  it('goes through once confirmed', async () => {
    const id = await created()
    await refresh(id)
    answer = () =>
      rowEnvelopeSchema.parse({ columns: ['sys_id', 'sys_sn'], rows: [{ sys_id: 'aa', sys_sn: '1' }] })
    expect((await refresh(id, { confirmColumnChange: true })).json()).toMatchObject({ outcome: 'applied' })
  })

  it('lets a new field through without asking', async () => {
    const id = await created()
    await refresh(id)
    answer = () =>
      rowEnvelopeSchema.parse({
        columns: [...COLUMNS, 'firmware'],
        rows: [{ ...row('aa'), firmware: '2.1.3' }],
      })
    expect((await refresh(id)).json()).toMatchObject({ outcome: 'applied', columnsAdded: ['firmware'] })
  })
})

describe('how stale it may get', () => {
  it('is manual only, until asked otherwise', async () => {
    // What this product did before there was any other option.
    expect((await create()).json()).toMatchObject({
      refreshIntervalSeconds: 0,
      refreshBeforePrint: false,
    })
  })

  it('can be changed without touching anything else', async () => {
    const id = await created()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/refresh-policy`,
      payload: { refreshIntervalSeconds: 300, refreshBeforePrint: true },
    })
    expect(res.json()).toMatchObject({ refreshIntervalSeconds: 300, refreshBeforePrint: true })
  })

  it('is not offered for a table nobody fetches', async () => {
    const id = await created()
    await app.inject({ method: 'POST', url: `/api/data-sources/${id}/unlink`, payload: { confirmed: true } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/refresh-policy`,
      payload: { refreshIntervalSeconds: 60 },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('releasing it', () => {
  it('keeps the rows and forgets the category', async () => {
    const id = await created()
    await refresh(id)
    const res = await app.inject({
      method: 'POST',
      url: `/api/data-sources/${id}/unlink`,
      payload: { confirmed: true },
    })
    expect(res.json()).toMatchObject({ sourceKind: 'local', rowCount: 3 })
    expect(res.json().nexus ?? null).toBeNull()
  })
})
