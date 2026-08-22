/**
 * Printing from a linked spreadsheet.
 *
 * The story's own acceptance criterion is "and then print a label with it".
 * Without this, "a linked source behaves like any other" is a claim in a
 * document rather than a fact about the system — and the ways it could be false
 * are not obvious: the rows come from a different creation path, so a `${column}`
 * that never resolves, or a row selection that lands on the wrong ordinals,
 * would look exactly like a working feature until the labels came out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { fakeSheetsPort } from '../../src/integrations/fake-sheets-port.ts'

let app: FastifyInstance
let printerId: string

const SPREADSHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const VALUES = [
  ['订单号', '收件人'],
  ['A-001', '张三'],
  ['A-002', '李四'],
  ['A-003', '王五'],
]

function seedPrinter(): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'niimbot', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0', printTaskName: 'B1',
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B3S_P', serial: null, firmwareVersion: null,
  })
  return printer.id
}

async function linkSheet(name = '本月出货'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: SPREADSHEET, worksheetId: 0, name },
  })
  return res.json().id as string
}

async function seedDesign(dataSourceId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/templates',
    payload: {
      name: '面单',
      printerKind: 'niimbot',
      widthMm: 50, heightMm: 30, dpi: 203,
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
          content: '${收件人}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        },
      ],
      variables: [],
      dataSourceId,
    },
  })
  return res.json().id as string
}

const submit = (payload: Record<string, unknown>, key = 'k1') =>
  app.inject({ method: 'POST', url: '/api/print-jobs', payload, headers: { 'idempotency-key': key } })

const snapshotOf = (): Record<string, unknown> => {
  const row = app.ctx.db.prepare('SELECT snapshot FROM print_jobs').get() as { snapshot: string }
  return JSON.parse(row.snapshot) as Record<string, unknown>
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: {
      port: fakeSheetsPort({
        spreadsheets: { [SPREADSHEET]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
        values: { [`${SPREADSHEET}/本月出货`]: VALUES },
      }),
      clientEmail: 'zenith@example.iam.gserviceaccount.com',
    },
  })
  await app.ready()
  printerId = seedPrinter()
})

afterEach(async () => {
  await app.close()
})

describe('a design bound to a linked spreadsheet', () => {
  it('prints, which is the whole point of linking one', async () => {
    const templateId = await seedDesign(await linkSheet())
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    expect(res.statusCode).toBe(202)
  })

  it('resolves ${column} to the spreadsheet values', async () => {
    const templateId = await seedDesign(await linkSheet())
    await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })

    const snapshot = snapshotOf()
    expect(snapshot.rows).toEqual([{ 订单号: 'A-001', 收件人: '张三' }, { 订单号: 'A-002', 收件人: '李四' }, { 订单号: 'A-003', 收件人: '王五' }])
  })

  it('honours a row selection by ordinal', async () => {
    const templateId = await seedDesign(await linkSheet())
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ids: [2] } })

    expect(res.statusCode).toBe(202)
    expect(snapshotOf().rows).toEqual([{ 订单号: 'A-002', 收件人: '李四' }])
  })

  it('honours a range, since ordinals are how ranges are expressed', async () => {
    const templateId = await seedDesign(await linkSheet())
    await submit({ printerId, templateId, copies: 1, rowSelection: { ranges: [[2, 3]] } })
    expect(snapshotOf().rows).toHaveLength(2)
  })

  it('copies the rows into the job rather than pointing at the table', async () => {
    // The snapshot is what makes history mean anything. A linked source can be
    // refreshed — or deleted — out from under an old job, so the job must
    // already hold its own copy, the same guarantee a CSV-backed source gives.
    const sourceId = await linkSheet()
    const templateId = await seedDesign(sourceId)
    await submit({ printerId, templateId, copies: 1, rowSelection: { ids: [1] } })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/data-sources/${sourceId}?confirm=true`,
    })
    // Asserted, because if this call quietly failed the test below would pass
    // while proving nothing at all.
    expect(deleted.statusCode).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources,
    ).toEqual([])

    expect(snapshotOf().rows).toEqual([{ 订单号: 'A-001', 收件人: '张三' }])
  })

  it('reports a design whose column is not in the sheet, rather than printing blanks', async () => {
    const sourceId = await linkSheet()
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '错的面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
        elements: [{
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
          content: '${不存在的列}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        }],
        variables: [], dataSourceId: sourceId,
      },
    })
    const bad = await submit({ printerId, templateId: res.json().id, copies: 1, rowSelection: { all: true } })
    expect(bad.statusCode).toBe(422)
  })
})
