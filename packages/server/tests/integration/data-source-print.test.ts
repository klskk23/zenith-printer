import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

/**
 * Printing a batch from a table.
 *
 * The assertions that matter are about *which* labels come out and in what
 * order: a stack of labels that does not line up with the spreadsheet is a
 * stack somebody has to sort by hand.
 */
let app: FastifyInstance
let printerId: string

function seedPrinter(): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'w', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0', printTaskName: 'B1',
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B3S_P', serial: null, firmwareVersion: null,
  })
  return printer.id
}

function multipart(text: string, name: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----zenithtest'
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.csv"\r\n` +
          'Content-Type: text/csv\r\n\r\n',
      ),
      Buffer.from(text),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

async function seedTable(rows: number, name = '订单表'): Promise<string> {
  const lines = ['订单号,收件人']
  for (let i = 1; i <= rows; i += 1) {
    lines.push(`A-${String(i).padStart(3, '0')},收件人${i}`)
  }
  const { payload, headers } = multipart(lines.join('\n'), name)
  return (await app.inject({ method: 'POST', url: '/api/data-sources', payload, headers })).json().id
}

async function seedDesign(
  dataSourceId: string | null,
  over: Record<string, unknown> = {},
): Promise<string> {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '面单',
        printerKind: 'niimbot',
        widthMm: 50,
        heightMm: 30,
        dpi: 203,
        elements: [
          {
            id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
            content: '${收件人}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
          },
        ],
        variables: [],
        dataSourceId,
        ...over,
      },
    })
  ).json().id
}

const submit = (payload: Record<string, unknown>, key = 'k1') =>
  app.inject({ method: 'POST', url: '/api/print-jobs', payload, headers: { 'idempotency-key': key } })

const jobOf = async (jobId: string) =>
  (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
  printerId = seedPrinter()
})

afterEach(async () => {
  await app.close()
})

describe('selecting rows', () => {
  it('prints one label per selected row, in table order', async () => {
    const templateId = await seedDesign(await seedTable(20))
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ranges: [[5, 12]] } })

    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(8)

    const job = await jobOf(res.json().jobId)
    expect(job.snapshot.rows.map((row: Record<string, string>) => row.收件人)).toEqual([
      '收件人5', '收件人6', '收件人7', '收件人8', '收件人9', '收件人10', '收件人11', '收件人12',
    ])
  })

  it('orders by row number however the boxes were ticked', async () => {
    // The labels come off in a stack; a stack in ticking order cannot be
    // checked against the spreadsheet (FR-037).
    const templateId = await seedDesign(await seedTable(10))
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ids: [9, 2, 5] } })

    const job = await jobOf(res.json().jobId)
    expect(job.snapshot.rows.map((row: Record<string, string>) => row.收件人)).toEqual([
      '收件人2', '收件人5', '收件人9',
    ])
  })

  it('takes the whole table on select-all', async () => {
    const templateId = await seedDesign(await seedTable(200))
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    expect(res.json().requestedCopies).toBe(200)
  })

  it('gives every copy of a row the same content, serial included (FR-036)', async () => {
    const poolId = (
      await app.inject({
        method: 'POST',
        url: '/api/sequence-pools',
        payload: { name: '流水', digits: 4, step: 1 },
      })
    ).json().id
    const sourceId = await seedTable(3)
    const templateId = await seedDesign(sourceId, {
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
          content: '${收件人} ${serial}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        },
      ],
      variables: [{ name: 'serial', kind: 'sequence', poolId }],
    })

    const res = await submit({ printerId, templateId, copies: 2, rowSelection: { all: true } })

    expect(res.json().requestedCopies).toBe(6)
    // Three rows, three serials — not six. Somebody asking for two of each
    // expects two matching labels, not two variants.
    expect(res.json().seqClaims[0]).toMatchObject({ start: 1, end: 3 })
  })
})

describe('refusals, all of them before anything prints', () => {
  it('refuses when the design uses a table but no rows are named', async () => {
    const templateId = await seedDesign(await seedTable(5))
    const res = await submit({ printerId, templateId, copies: 1 })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('NO_ROWS_SELECTED')
  })

  it('refuses an empty selection', async () => {
    const templateId = await seedDesign(await seedTable(5))
    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ranges: [], ids: [] } })
    expect(res.json().code).toBe('NO_ROWS_SELECTED')
  })

  it('refuses more labels than one job may hold, before rendering or claiming', async () => {
    const templateId = await seedDesign(await seedTable(600))
    const res = await submit({ printerId, templateId, copies: 2, rowSelection: { all: true } })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('BATCH_TOO_LARGE')
    expect(res.json().details).toMatchObject({ requested: 1200, maxLabels: 1000, rows: 600, copies: 2 })
    // Nothing was queued: a refused job must not leave a row behind.
    expect((await app.inject({ method: 'GET', url: '/api/print-jobs' })).json().jobs).toHaveLength(0)
  })

  it('accepts a batch sitting exactly on the ceiling', async () => {
    const templateId = await seedDesign(await seedTable(500))
    const res = await submit({ printerId, templateId, copies: 2, rowSelection: { all: true } })
    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(1000)
  })

  it('refuses a selection naming rows that have since been deleted', async () => {
    // Somebody who selected eight rows expects eight labels. Printing seven
    // without saying so leaves a discrepancy found at counting time (FR-033a).
    const sourceId = await seedTable(20)
    const templateId = await seedDesign(sourceId)
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${sourceId}/rows`,
      payload: { deletes: [7] },
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ids: [5, 20] } })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('ROW_SELECTION_STALE')
    expect(res.json().details.missingOrdinals).toEqual([20])
  })

  it('does not refuse select-all when rows have been deleted', async () => {
    // `all` is defined as "whatever is there now", so it cannot go stale.
    const sourceId = await seedTable(20)
    const templateId = await seedDesign(sourceId)
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${sourceId}/rows`,
      payload: { deletes: [7] },
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(19)
  })

  it('refuses when a barcode-bound column is empty in a selected row', async () => {
    // Barcode content cannot be empty. Without this the encoder throws partway
    // through, after some labels are already out (FR-045b).
    const { payload, headers } = multipart('订单号,条码\nA-001,X1\nA-002,\nA-003,X3', '订单表')
    const sourceId = (
      await app.inject({ method: 'POST', url: '/api/data-sources', payload, headers })
    ).json().id
    const templateId = await seedDesign(sourceId, {
      elements: [
        {
          id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12,
          content: '${条码}', symbology: 'code128',
        },
      ],
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('BARCODE_EMPTY_VALUE')
    expect(res.json().details).toMatchObject({ column: '条码', ordinals: [2] })
  })

  it('does not refuse when the empty row was not selected', async () => {
    // A blank in row 2 is somebody else's problem when rows 1 and 3 are what
    // is being printed today.
    const { payload, headers } = multipart('订单号,条码\nA-001,X1\nA-002,\nA-003,X3', '订单表')
    const sourceId = (
      await app.inject({ method: 'POST', url: '/api/data-sources', payload, headers })
    ).json().id
    const templateId = await seedDesign(sourceId, {
      elements: [
        {
          id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12,
          content: '${条码}', symbology: 'code128',
        },
      ],
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { ids: [1, 3] } })
    expect(res.statusCode).toBe(202)
  })

  it('refuses a constant that shares a name with a column of the bound table', async () => {
    // One name pointing at two values leaves no way to say which is meant, and
    // a precedence rule would let adding a column change what a label prints
    // without the person adding it knowing (FR-009b).
    const sourceId = await seedTable(3)
    const templateId = await seedDesign(sourceId, {
      variables: [{ name: '收件人', kind: 'constant', value: '固定收件人' }],
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('VARIABLE_NAME_COLLIDES')
    expect(res.json().details.name).toBe('收件人')
  })
})

describe('the snapshot is self-contained', () => {
  it('does not change when the table is edited afterwards (SC-005)', async () => {
    const sourceId = await seedTable(5)
    const templateId = await seedDesign(sourceId)
    const jobId = (
      await submit({ printerId, templateId, copies: 1, rowSelection: { ranges: [[1, 3]] } })
    ).json().jobId

    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${sourceId}/rows`,
      payload: { upserts: [{ ordinal: 2, values: { 收件人: '改过了' } }] },
    })

    const job = await jobOf(jobId)
    expect(job.snapshot.rows[1].收件人).toBe('收件人2')
  })

  it('does not change when rows are deleted afterwards', async () => {
    const sourceId = await seedTable(5)
    const templateId = await seedDesign(sourceId)
    const jobId = (
      await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    ).json().jobId

    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${sourceId}/rows`,
      payload: { deletes: [1, 2, 3, 4, 5] },
    })

    const job = await jobOf(jobId)
    expect(job.snapshot.rows).toHaveLength(5)
  })

  it('survives the table being deleted outright', async () => {
    const sourceId = await seedTable(5)
    const templateId = await seedDesign(sourceId)
    const jobId = (
      await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    ).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/data-sources/${sourceId}?confirm=true` })

    const job = await jobOf(jobId)
    expect(job.snapshot.rows).toHaveLength(5)
    expect(job.snapshot.rows[0].收件人).toBe('收件人1')
  })

  it('reprints from the snapshot, not from the table', async () => {
    // FR-040. The reprint is of what was printed, whatever the table says now.
    const sourceId = await seedTable(3)
    const templateId = await seedDesign(sourceId)
    const jobId = (
      await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })
    ).json().jobId

    app.ctx.db.prepare("UPDATE print_jobs SET status = 'failed', pages_printed = 1 WHERE id = ?").run(jobId)
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${sourceId}/rows`,
      payload: { upserts: [{ ordinal: 1, values: { 收件人: '改过了' } }] },
    })

    const reprint = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${jobId}/reprint`,
      payload: { copies: 2 },
      headers: { 'idempotency-key': 'rp1' },
    })
    expect(reprint.statusCode).toBe(202)
    const copy = await jobOf(reprint.json().jobId)
    expect(copy.snapshot.rows[0].收件人).toBe('收件人1')
  })
})

describe('a design with no data source', () => {
  it('still prints copies of one label, as it always did', async () => {
    const templateId = await seedDesign(null, {
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
          content: '固定内容', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        },
      ],
    })
    const res = await submit({ printerId, templateId, copies: 5 })
    expect(res.json().requestedCopies).toBe(5)
    expect((await jobOf(res.json().jobId)).snapshot.rows).toEqual([])
  })

  it('ignores a rowSelection it was given anyway', async () => {
    const templateId = await seedDesign(null, {
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
          content: '固定内容', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        },
      ],
    })
    const res = await submit({ printerId, templateId, copies: 3, rowSelection: { all: true } })
    expect(res.json().requestedCopies).toBe(3)
  })
})

describe('the overflow check does not scale with the batch', () => {
  /**
   * FR-045. The check used to run per copy, encoding a barcode for each — a
   * thousand encodes before the first label could come out, which is exactly
   * the wait the page source exists to remove.
   *
   * A thousand-row batch whose barcode overflows on every row is the case that
   * tells the two apart: per-row checking reports a thousand warnings, checking
   * the design reports one.
   */
  it('reports one warning for a batch where every row would overflow', async () => {
    const wide = 'A'.repeat(60)
    const lines = ['订单号,条码']
    for (let i = 1; i <= 500; i += 1) {
      lines.push(`A-${i},${wide}`)
    }
    const { payload, headers } = multipart(lines.join('\n'), '宽条码表')
    const sourceId = (
      await app.inject({ method: 'POST', url: '/api/data-sources', payload, headers })
    ).json().id

    const templateId = await seedDesign(sourceId, {
      elements: [
        {
          id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12,
          content: '${条码}', symbology: 'code128', moduleWidthDots: 2,
        },
      ],
    })

    const res = await submit({ printerId, templateId, copies: 1, rowSelection: { all: true } })

    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(500)
    // One, not five hundred.
    expect(res.json().overflowWarnings.length).toBeLessThanOrEqual(1)
  })
})
