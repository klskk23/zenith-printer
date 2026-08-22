/**
 * When a refresh brings nothing back.
 *
 * The promise being tested: the rows already here are untouched and still
 * print. An external service being down must not stop a label from coming out
 * of a printer — it only means the data is not the newest.
 *
 * Every failure kind is exercised, including `timeout` and `rateLimited`, which
 * are nearly impossible to produce on demand against the real service and would
 * therefore have no test anywhere else.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '../../src/integrations/fake-sheets-port.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { SHEETS_ERROR_KINDS } from '../../src/domain/google-sheets.ts'
import { MAX_ROWS } from '../../src/domain/data-source.ts'

let app: FastifyInstance
let printerId: string

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const HEALTHY: FakeSheetsScript = {
  spreadsheets: { [ID]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
  values: { [`${ID}/本月出货`]: [['订单号', '收件人'], ['A-001', '张三'], ['A-002', '李四']] },
}

function seedPrinter(): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'p', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0', printTaskName: 'B1',
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B3S_P', serial: null, firmwareVersion: null,
  })
  return printer.id
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: { port: fakeSheetsPort(HEALTHY), clientEmail: 'r@example.com' },
  })
  await app.ready()
  printerId = seedPrinter()
})

afterEach(async () => {
  await app.close()
})

async function linked(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: ID, worksheetId: 0, name: '本月出货' },
  })
  return res.json().id as string
}

function breakSheets(script: FakeSheetsScript): void {
  ;(app.ctx as { sheets: { port: unknown } }).sheets.port = fakeSheetsPort(script)
}

const refresh = (id: string) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload: {} })

const rowsOf = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=1&pageSize=100` })).json()

describe('every way a refresh can fail', () => {
  for (const kind of SHEETS_ERROR_KINDS) {
    it(`reports ${kind} and changes nothing`, async () => {
      const id = await linked()
      const before = await rowsOf(id)

      breakSheets({ failWith: kind })
      const res = await refresh(id)

      // 200, not 5xx: the server did what it was asked and has a conclusion.
      // An error status would invite the browser to retry something that is
      // not a transport problem.
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ outcome: 'failed', reason: kind })
      expect(await rowsOf(id)).toEqual(before)
    })
  }

  it('leaves the columns alone as well as the rows', async () => {
    const id = await linked()
    breakSheets({ failWith: 'notShared' })
    await refresh(id)

    const source = (await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources[0]
    expect(source.columns).toEqual(['订单号', '收件人'])
  })

  it('does not move the refresh time, since nothing was refreshed', async () => {
    const id = await linked()
    const before = (await app.inject({ method: 'GET', url: '/api/data-sources' })).json()
      .dataSources[0].lastRefreshedAt

    breakSheets({ failWith: 'unreachable' })
    await refresh(id)

    const after = (await app.inject({ method: 'GET', url: '/api/data-sources' })).json()
      .dataSources[0].lastRefreshedAt
    expect(after).toBe(before)
  })
})

describe('printing after a failed refresh', () => {
  it('still works, which is the whole point of keeping the rows', async () => {
    const id = await linked()
    const template = (
      await app.inject({
        method: 'POST',
        url: '/api/templates',
        payload: {
          name: '面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
          elements: [{
            id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
            content: '${收件人}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
          }],
          variables: [], dataSourceId: id,
        },
      })
    ).json().id

    breakSheets({ failWith: 'notShared' })
    expect((await refresh(id)).json().outcome).toBe('failed')

    const job = await app.inject({
      method: 'POST',
      url: '/api/print-jobs',
      payload: { printerId, templateId: template, copies: 1, rowSelection: { all: true } },
      headers: { 'idempotency-key': 'k1' },
    })
    expect(job.statusCode).toBe(202)
  })
})

describe('a table that outgrew the limit', () => {
  it('is refused rather than truncated', async () => {
    // Truncating would print labels for rows 1..10000 and leave nobody aware
    // the rest existed. Stale data is the lesser problem by a wide margin.
    const id = await linked()
    const big = [['订单号', '收件人'], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`A-${i}`, `n${i}`])]
    breakSheets({ ...HEALTHY, values: { [`${ID}/本月出货`]: big } })

    const res = await refresh(id)
    expect(res.json()).toMatchObject({
      outcome: 'refusedTooManyRows',
      rowCount: MAX_ROWS + 1,
      limit: MAX_ROWS,
    })
    expect((await rowsOf(id)).total).toBe(2)
  })

  it('accepts exactly the limit', async () => {
    const id = await linked()
    const atLimit = [['订单号', '收件人'], ...Array.from({ length: MAX_ROWS }, (_, i) => [`A-${i}`, `n${i}`])]
    breakSheets({ ...HEALTHY, values: { [`${ID}/本月出货`]: atLimit } })

    expect((await refresh(id)).json().outcome).toBe('applied')
  })
})
