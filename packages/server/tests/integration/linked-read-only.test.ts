/**
 * A linked table is read-only here, and can be released.
 *
 * The read-only part prevents one specific silent loss: somebody edits a cell,
 * the next refresh replaces the table wholesale, and the edit is gone with
 * nothing said. Unlinking is the way out — keep the rows, drop the origin —
 * so that "take this table over" never has to mean "lose this table".
 *
 * The guard lives on the server as well as in the UI. This service has no
 * authentication and anybody on the network can call the endpoint directly, so
 * a disabled button is the first line and not the line.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort } from '../../src/integrations/fake-sheets-port.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'

let app: FastifyInstance
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: {
      port: fakeSheetsPort({
        spreadsheets: { [ID]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
        values: { [`${ID}/本月出货`]: [['订单号', '收件人'], ['A-001', '张三'], ['A-002', '李四']] },
      }),
      clientEmail: 'zenith@example.iam.gserviceaccount.com',
    },
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function linked(name = '本月出货'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: ID, worksheetId: 0, name },
  })
  return res.json().id as string
}

function local(name = '本地表'): string {
  const repo = new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  return repo.create({ name, columns: ['a'], rows: [{ a: '1' }] }).id
}

/** Patch row 1, using whatever columns that data source actually has. */
const patchRows = (id: string, values: Record<string, string> = { 订单号: 'CHANGED', 收件人: 'CHANGED' }) =>
  app.inject({
    method: 'PATCH',
    url: `/api/data-sources/${id}/rows`,
    payload: { upserts: [{ ordinal: 1, values }], deletes: [] },
  })

const rename = (id: string, name: string) =>
  app.inject({ method: 'PATCH', url: `/api/data-sources/${id}`, payload: { name } })

const unlink = (id: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/unlink`, payload: body })

describe('editing a linked table', () => {
  it('is refused, because the next refresh would erase the edit', async () => {
    const id = await linked()
    const res = await patchRows(id)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DATA_SOURCE_READ_ONLY')
  })

  it('leaves the rows untouched when refused', async () => {
    const id = await linked()
    await patchRows(id)
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=10` })).json()
    expect(rows.rows[0].values.订单号).toBe('A-001')
  })

  it('refuses a wholesale replacement too', async () => {
    const id = await linked()
    const res = await app.inject({
      method: 'POST',
      url: `/api/data-sources/${id}/replace?confirm=true`,
      payload: Buffer.from('x'),
      headers: { 'content-type': 'multipart/form-data; boundary=zzz' },
    })
    expect(res.json().code).toBe('DATA_SOURCE_READ_ONLY')
  })

  it('still allows renaming, because a name is a label and not the contents', async () => {
    const id = await linked()
    expect((await rename(id, '改个名字')).statusCode).toBe(200)
  })

  it('does not touch a table maintained here', async () => {
    const id = local()
    expect((await patchRows(id, { a: 'CHANGED' })).statusCode).toBe(200)
  })
})

describe('releasing a linked table', () => {
  it('asks first, because the origin cannot be recovered', async () => {
    const id = await linked()
    const res = await unlink(id)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DATA_SOURCE_UNLINK_NOT_CONFIRMED')
  })

  it('says what will be lost, not just "are you sure"', async () => {
    const id = await linked()
    const body = (await unlink(id)).json()
    expect(body.what.length).toBeGreaterThan(0)
    expect(`${body.why} ${body.next}`).toMatch(/刷新/)
  })

  it('keeps every row', async () => {
    const id = await linked()
    const res = await unlink(id, { confirmed: true })

    expect(res.statusCode).toBe(200)
    expect(res.json().sourceKind).toBe('local')
    expect(res.json().rowCount).toBe(2)
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=10` })).json()
    expect(rows.rows).toHaveLength(2)
  })

  it('leaves nothing of the origin on the wire', async () => {
    const id = await linked()
    const body = (await unlink(id, { confirmed: true })).json()
    for (const field of ['spreadsheetId', 'spreadsheetTitle', 'worksheetId', 'worksheetTitle', 'lastRefreshedAt']) {
      expect(body[field]).toBeUndefined()
    }
  })

  it('makes the table editable again — the execution path, not just the guard', async () => {
    // Testing only that the guard fires would pass with the guard hard-coded
    // to always refuse. What matters is that releasing actually releases.
    const id = await linked()
    await unlink(id, { confirmed: true })

    expect((await patchRows(id)).statusCode).toBe(200)
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=10` })).json()
    expect(rows.rows[0].values.订单号).toBe('CHANGED')
  })

  it('can no longer be refreshed once released', async () => {
    const id = await linked()
    await unlink(id, { confirmed: true })
    const res = await app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload: {} })
    expect(res.json().code).toBe('DATA_SOURCE_NOT_LINKED')
  })

  it('refuses to release a table that was never linked', async () => {
    const id = local()
    const res = await unlink(id, { confirmed: true })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DATA_SOURCE_NOT_LINKED')
  })
})
