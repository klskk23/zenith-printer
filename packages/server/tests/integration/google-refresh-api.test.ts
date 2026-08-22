/**
 * Refreshing a linked data source.
 *
 * The rule the whole feature rests on: a refresh either replaces the table
 * wholesale or changes nothing at all. Half a refresh — new columns with old
 * rows, or the first ten thousand of twelve thousand rows — is the shape of
 * failure that only shows up on printed labels.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '../../src/integrations/fake-sheets-port.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'

let app: FastifyInstance
let clock: FixedClock

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const ROBOT = 'zenith@example.iam.gserviceaccount.com'

const SHEET = (worksheetTitle = '本月出货') => ({
  title: '出货台账',
  worksheets: [{ id: 0, title: worksheetTitle }],
})

const ROWS_2 = [
  ['订单号', '收件人'],
  ['A-001', '张三'],
  ['A-002', '李四'],
]

async function start(script: FakeSheetsScript): Promise<void> {
  clock = new FixedClock('2026-08-22T00:00:00Z')
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock,
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: { port: fakeSheetsPort(script), clientEmail: ROBOT },
  })
  await app.ready()
}

const script = (worksheetTitle = '本月出货', values = ROWS_2): FakeSheetsScript => ({
  spreadsheets: { [ID]: SHEET(worksheetTitle) },
  values: { [`${ID}/${worksheetTitle}`]: values },
})

async function link(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: ID, worksheetId: 0, name: '本月出货' },
  })
  return res.json().id as string
}

const refresh = (id: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload: body })

const rowsOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=100` })).json()

/** Swap what the fake will hand back next, as editing the sheet would. */
function rescript(next: FakeSheetsScript): void {
  ;(app.ctx as { sheets: { port: unknown } }).sheets.port = fakeSheetsPort(next)
}

afterEach(async () => {
  await app.close()
})

describe('a successful refresh', () => {
  it('replaces the rows and says how many there were before', async () => {
    await start(script())
    const id = await link()

    rescript(script('本月出货', [...ROWS_2, ['A-003', '王五']]))
    const res = await refresh(id)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ outcome: 'applied', rowsBefore: 2, rowsAfter: 3 })
    expect((await rowsOf(id)).total).toBe(3)
  })

  it('moves the refresh time forward', async () => {
    await start(script())
    const id = await link()

    clock.set('2026-08-23T09:00:00Z')
    const res = await refresh(id)
    expect(res.json().lastRefreshedAt).toBe('2026-08-23T09:00:00.000Z')
  })

  it('keeps values exactly as the sheet shows them', async () => {
    await start(script())
    const id = await link()
    rescript(script('本月出货', [['订单号', '收件人'], ['007', '张三']]))
    await refresh(id)

    expect((await rowsOf(id)).rows[0].values.订单号).toBe('007')
  })

  it('still works after the worksheet was renamed in Google', async () => {
    // The id is what we stored; the title is what the read endpoint wants. A
    // rename changes the title and not the id, so storing only the title would
    // break a refresh that had nothing wrong with it.
    await start(script())
    const id = await link()

    rescript(script('改过名的工作表', ROWS_2))
    const res = await refresh(id)

    expect(res.statusCode).toBe(200)
    expect(res.json().outcome).toBe('applied')

    const repo = new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
    expect(repo.find(id)?.link?.worksheetTitle).toBe('改过名的工作表')
  })
})

describe('what cannot be refreshed', () => {
  it('is a 404 for a data source that does not exist', async () => {
    await start(script())
    expect((await refresh('nope')).statusCode).toBe(404)
  })

  it('refuses a data source that was never linked', async () => {
    await start(script())
    const repo = new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
    const local = repo.create({ name: '本地表', columns: ['a'], rows: [] })

    const res = await refresh(local.id)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DATA_SOURCE_NOT_LINKED')
  })
})

describe('two refreshes at once', () => {
  it('writes once and turns the second away', async () => {
    // Two writers on the same table is how a half-replaced table happens.
    await start(script())
    const id = await link()
    // Held open, so the two requests genuinely overlap. With an instantaneous
    // fake the first finishes before the second starts and the guard is never
    // exercised — the test would pass whether or not it existed.
    rescript({ ...script('本月出货', [...ROWS_2, ['A-003', '王五']]), delayMs: 40 })

    const [first, second] = await Promise.all([refresh(id), refresh(id)])
    const codes = [first.statusCode, second.statusCode].sort()

    expect(codes).toEqual([200, 409])
    const refused = first.statusCode === 409 ? first : second
    expect(refused.json().code).toBe('DATA_SOURCE_REFRESH_IN_PROGRESS')
    expect((await rowsOf(id)).total).toBe(3)
  })

  it('lets a later refresh proceed once the first has finished', async () => {
    await start(script())
    const id = await link()
    await refresh(id)
    expect((await refresh(id)).statusCode).toBe(200)
  })
})
