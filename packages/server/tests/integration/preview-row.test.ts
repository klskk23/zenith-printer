/**
 * Previewing a specific row of the bound table.
 *
 * `rowOrdinal` has been on this endpoint since data sources arrived, and until
 * now nothing on the server side has ever exercised it — every test that
 * touches `/api/preview` is a browser test against a stubbed fetch. It turns
 * out only to have been honoured when a `templateId` came with it, and the
 * print dialog deliberately does not send one: it previews the design *on
 * screen*, edits included, because a preview of the saved version is a preview
 * of something other than what the operator is looking at.
 *
 * So every preview the dialog has ever asked for ignored the row it named. One
 * label is one label and nobody could tell; a grid of ten identical labels,
 * captioned as ten different rows, is a lie the feature exists to prevent.
 *
 * What is asserted here is the substance rather than the plumbing: two rows
 * with different text must produce different bitmaps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

let app: FastifyInstance
let printerId: string

const IR = {
  widthMm: 40,
  heightMm: 20,
  dpi: 203,
  elements: [
    {
      id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 36, heightMm: 6,
      content: '${收件人}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 4,
    },
  ],
}

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

/** Three rows whose text differs enough that the bitmaps must differ too. */
async function seedTable(): Promise<string> {
  const boundary = '----zenithtest'
  const csv = ['订单号,收件人', 'A-1,甲', 'A-2,乙乙乙乙乙乙', 'A-3,丙'].join('\n')
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n订单表\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.csv"\r\n` +
        'Content-Type: text/csv\r\n\r\n',
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await app.inject({
    method: 'POST', url: '/api/data-sources', payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  })
  return res.json().id
}

const preview = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/preview', payload: { printerId, ir: IR, ...body } })

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-31T00:00:00Z'),
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

describe('drawing a row of the bound table', () => {
  it('renders the row it was asked for', async () => {
    const dataSourceId = await seedTable()

    const one = await preview({ dataSourceId, rowOrdinal: 1 })
    const two = await preview({ dataSourceId, rowOrdinal: 2 })

    expect(one.statusCode).toBe(200)
    expect(two.statusCode).toBe(200)
    // Different text, therefore different ink. Equal bytes would mean the
    // ordinal was read and thrown away.
    expect(one.rawPayload.equals(two.rawPayload)).toBe(false)
  })

  it('falls back to the first row when no ordinal is given', async () => {
    // What the dialog sends with nothing selected, and what the preview showed
    // before any of this existed.
    const dataSourceId = await seedTable()

    const implicit = await preview({ dataSourceId })
    const first = await preview({ dataSourceId, rowOrdinal: 1 })

    expect(implicit.rawPayload.equals(first.rawPayload)).toBe(true)
  })

  it('is the same picture whichever way the same row is asked for', async () => {
    const dataSourceId = await seedTable()
    const a = await preview({ dataSourceId, rowOrdinal: 3 })
    const b = await preview({ dataSourceId, rowOrdinal: 3 })
    expect(a.rawPayload.equals(b.rawPayload)).toBe(true)
  })

  it('lets explicit values override a column of the same name', async () => {
    // The design's own variables are resolved after the row, and a design that
    // defines a name is the design's business — the collision is warned about
    // in the editor rather than resolved by precedence here.
    const dataSourceId = await seedTable()

    const row = await preview({ dataSourceId, rowOrdinal: 2 })
    const overridden = await preview({
      dataSourceId, rowOrdinal: 2, variableValues: { 收件人: '甲' },
    })
    const asRowOne = await preview({ dataSourceId, rowOrdinal: 1 })

    expect(overridden.rawPayload.equals(row.rawPayload)).toBe(false)
    expect(overridden.rawPayload.equals(asRowOne.rawPayload)).toBe(true)
  })
})

describe('when the row is not there', () => {
  it('says the reference is unresolved rather than drawing an empty label', async () => {
    // Blank is the dangerous answer: a label that prints nothing where a name
    // belongs looks like a design problem, not a missing row.
    const dataSourceId = await seedTable()
    const res = await preview({ dataSourceId, rowOrdinal: 99 })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('VARIABLE_NOT_DEFINED')
  })

  it('refuses an ordinal below one', async () => {
    const dataSourceId = await seedTable()
    expect((await preview({ dataSourceId, rowOrdinal: 0 })).statusCode).toBe(400)
  })
})
