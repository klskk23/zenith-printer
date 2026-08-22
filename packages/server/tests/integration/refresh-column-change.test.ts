/**
 * When the spreadsheet's header changes under a design.
 *
 * A column name is a reference name — a design writes `${收件人}`. Losing one
 * makes every such reference resolve to nothing, and a blank where a name used
 * to be is not a failure anybody notices until the labels are in their hands.
 * So that refresh stops and asks. Gaining a column harms nothing and does not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '../../src/integrations/fake-sheets-port.ts'

let app: FastifyInstance
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

const sheet = (header: string[], row: string[]): FakeSheetsScript => ({
  spreadsheets: { [ID]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
  values: { [`${ID}/本月出货`]: [header, row] },
})

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: { port: fakeSheetsPort(sheet(['订单号', '收件人'], ['A-001', '张三'])), clientEmail: 'r@example.com' },
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function rescript(script: FakeSheetsScript): void {
  ;(app.ctx as { sheets: { port: unknown } }).sheets.port = fakeSheetsPort(script)
}

async function linked(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: ID, worksheetId: 0, name: '本月出货' },
  })
  return res.json().id as string
}

async function design(sourceId: string, content = '${收件人}'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/templates',
    payload: {
      name: '出货面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
      elements: [{
        id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
        content, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
      }],
      variables: [], dataSourceId: sourceId,
    },
  })
  return res.json().id as string
}

const refresh = (id: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/data-sources/${id}/refresh`, payload: body })

const columnsOf = async (): Promise<string[]> =>
  (await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources[0].columns

describe('a column was added', () => {
  it('applies without asking, because it breaks nothing', async () => {
    const id = await linked()
    rescript(sheet(['订单号', '收件人', '备注'], ['A-001', '张三', 'x']))

    const res = await refresh(id)
    expect(res.json()).toMatchObject({ outcome: 'applied', columnsAdded: ['备注'] })
    expect(await columnsOf()).toEqual(['订单号', '收件人', '备注'])
  })

  it('applies even when a design uses the table', async () => {
    const id = await linked()
    await design(id)
    rescript(sheet(['订单号', '收件人', '备注'], ['A-001', '张三', 'x']))
    expect((await refresh(id)).json().outcome).toBe('applied')
  })
})

describe('a column was lost', () => {
  it('stops and names what went, changing nothing', async () => {
    const id = await linked()
    rescript(sheet(['订单号'], ['A-001']))

    const res = await refresh(id)
    expect(res.json()).toMatchObject({
      outcome: 'needsConfirmation',
      removedColumns: ['收件人'],
      addedColumns: [],
    })
    // Not applied: the columns and the rows are exactly as they were.
    expect(await columnsOf()).toEqual(['订单号', '收件人'])
  })

  it('lists the designs that would stop resolving', async () => {
    const id = await linked()
    await design(id)
    rescript(sheet(['订单号'], ['A-001']))

    const res = await refresh(id)
    expect(res.json().affectedTemplates).toEqual([
      expect.objectContaining({ name: '出货面单' }),
    ])
  })

  it('reports no designs when none referenced the lost column', async () => {
    // Still asks: losing a column is a change to the shape of the table, and
    // the person refreshing may not be the person who will design against it.
    const id = await linked()
    await design(id, '${订单号}')
    rescript(sheet(['订单号'], ['A-001']))

    const res = await refresh(id)
    expect(res.json().outcome).toBe('needsConfirmation')
    expect(res.json().affectedTemplates).toEqual([])
  })

  it('goes ahead once confirmed', async () => {
    const id = await linked()
    await design(id)
    rescript(sheet(['订单号'], ['A-001']))

    const res = await refresh(id, { confirmColumnChange: true })
    expect(res.json().outcome).toBe('applied')
    expect(await columnsOf()).toEqual(['订单号'])
  })

  it('leaves the affected design carrying the existing binding warning', async () => {
    const id = await linked()
    const templateId = await design(id)
    rescript(sheet(['订单号'], ['A-001']))
    await refresh(id, { confirmColumnChange: true })

    const template = (await app.inject({ method: 'GET', url: `/api/templates/${templateId}` })).json()
    expect(template.bindingIssue).toMatchObject({ kind: 'columnsMissing', columns: ['收件人'] })
  })
})

describe('a column was renamed', () => {
  it('is treated as a loss, because Google reports no difference', async () => {
    // "收件人 renamed to 客户名称" and "收件人 deleted, 客户名称 added" arrive as
    // the same header. Guessing which one happened would be wrong about as
    // often as it is right, and being wrong binds a design to the wrong column.
    const id = await linked()
    await design(id)
    rescript(sheet(['订单号', '客户名称'], ['A-001', '张三']))

    const res = await refresh(id)
    expect(res.json()).toMatchObject({
      outcome: 'needsConfirmation',
      removedColumns: ['收件人'],
      addedColumns: ['客户名称'],
    })
  })
})
