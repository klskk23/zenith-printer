/**
 * What a refresh leaves behind in the log.
 *
 * A refresh silently rewrites a whole table. Months later somebody asks why a
 * batch of labels had the recipients it had, and the answer has to exist
 * somewhere (Principle V).
 *
 * What must *not* be there is the row values. Business data does not belong in
 * logs — the same boundary the credentials rule guards, reached through a
 * different door.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '../../src/integrations/fake-sheets-port.ts'

let app: FastifyInstance
let logged: Array<Record<string, unknown>>

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const sheet = (header: string[], rows: string[][]): FakeSheetsScript => ({
  spreadsheets: { [ID]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
  values: { [`${ID}/本月出货`]: [header, ...rows] },
})

beforeEach(async () => {
  logged = []
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: {
      port: fakeSheetsPort(sheet(['订单号', '收件人'], [['A-001', '张三']])),
      clientEmail: 'r@example.com',
    },
  })
  await app.ready()
  // Capture what the handler reports rather than what pino chose to print.
  app.log.info = ((obj: Record<string, unknown>) => {
    logged.push(obj)
  }) as never
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

function rescript(script: FakeSheetsScript): void {
  ;(app.ctx as { sheets: { port: unknown } }).sheets.port = fakeSheetsPort(script)
}

const refresh = (id: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload: body })

const refreshLogs = (): Array<Record<string, unknown>> =>
  logged.filter((entry) => entry.event === 'data_source_refresh')

describe('a refresh leaves a record of what it concluded', () => {
  it('records an applied refresh with the row counts', async () => {
    const id = await linked()
    rescript(sheet(['订单号', '收件人'], [['A-001', '张三'], ['A-002', '李四']]))
    await refresh(id)

    expect(refreshLogs()).toContainEqual(
      expect.objectContaining({ dataSourceId: id, outcome: 'applied', rowsBefore: 1, rowsAfter: 2 }),
    )
  })

  it('records a failure and why', async () => {
    const id = await linked()
    rescript({ failWith: 'notShared' })
    await refresh(id)

    expect(refreshLogs()).toContainEqual(
      expect.objectContaining({ outcome: 'failed', reason: 'notShared' }),
    )
  })

  it('records a refusal on row count', async () => {
    const id = await linked()
    rescript(sheet(['订单号', '收件人'], Array.from({ length: 10_001 }, (_, i) => [`A-${i}`, 'x'])))
    await refresh(id)

    expect(refreshLogs()).toContainEqual(
      expect.objectContaining({ outcome: 'refusedTooManyRows', rowCount: 10_001 }),
    )
  })

  it('records a header change that is waiting for confirmation', async () => {
    const id = await linked()
    rescript(sheet(['订单号'], [['A-001']]))
    await refresh(id)

    expect(refreshLogs()).toContainEqual(
      expect.objectContaining({ outcome: 'needsConfirmation', removedColumns: ['收件人'] }),
    )
  })

  it('never writes a row value into the log', async () => {
    const id = await linked()
    rescript(sheet(['订单号', '收件人'], [['机密订单号', '某位客户']]))
    await refresh(id)

    const text = JSON.stringify(refreshLogs())
    expect(text).not.toContain('机密订单号')
    expect(text).not.toContain('某位客户')
  })
})
