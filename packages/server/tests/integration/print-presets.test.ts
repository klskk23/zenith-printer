/**
 * Printing a batch of rows through a named preset.
 *
 * What this is for: a system on the other side of an HTTP call should be able
 * to print without knowing what a template is or which printer is which. It
 * hands over rows and a preset id. Which design, which printer, which settings
 * and how many copies stay decisions made in front of the machine, and any of
 * them can change here without the caller being redeployed.
 *
 * The two properties worth the most here are the ones that would be plausible
 * to get wrong and expensive to discover: that a repeated request does not
 * produce a second batch of stock, and that a design needing a column the batch
 * does not carry says *which* column rather than "something is missing".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

let app: FastifyInstance
let printerId: string
let templateId: string

function seedPrinter(probed = true): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'w', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0', printTaskName: 'B1',
  })
  if (probed) {
    repo.saveCapabilities(printer.id, {
      dpi: 203, printheadPixels: 576, densityMin: 1, densityMax: 5, densityDefault: 3,
      paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
      model: 'B3S_P', serial: null, firmwareVersion: null,
    })
  }
  return printer.id
}

/** A design referencing two columns, with no data source bound to it. */
async function seedTemplate(content = '${mac} / ${sn}', name = '设备标签'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/templates',
    payload: {
      name, printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 44, heightMm: 6,
          content, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
        },
      ],
      variables: [],
      dataSourceId: null,
    },
  })
  return res.json().id as string
}

const createPreset = (over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/print-presets',
    payload: { name: '设备标签预设', templateId, printerId, ...over },
  })

const envelope = (rows: Array<Record<string, string>>, columns = ['mac', 'sn']) => ({ columns, rows })

const ROWS = [
  { mac: '001A2B3C4D5E', sn: '112394521950' },
  { mac: '001A2B3C4D5F', sn: '112394521951' },
]

const print = (presetId: string, body: unknown, key?: string) =>
  app.inject({
    method: 'POST',
    url: `/api/print-presets/${presetId}/print`,
    payload: body as never,
    headers: key === undefined ? {} : { 'idempotency-key': key },
  })

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-09-01T12:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
  printerId = seedPrinter()
  templateId = await seedTemplate()
})

afterEach(async () => {
  await app.close()
})

describe('managing presets', () => {
  it('answers under a `presets` envelope, which the ledger fills a dropdown from', async () => {
    // Part of the contract rather than an implementation detail: the other
    // side reads `presets[].name` straight into a select.
    await createPreset()
    const body = (await app.inject({ method: 'GET', url: '/api/print-presets' })).json()
    expect(Object.keys(body)).toEqual(['presets'])
    expect(body.presets[0]).toMatchObject({ id: expect.any(String), name: '设备标签预设' })
  })

  it('lets one batch override the copy count', async () => {
    // The caller sometimes knows something the preset cannot — "two per device
    // this time" — while the preset stays the normal answer.
    const id = (await createPreset({ copies: 1 })).json().id as string
    const res = await app.inject({
      method: 'POST',
      url: `/api/print-presets/${id}/print`,
      payload: { columns: ['mac', 'sn'], rows: ROWS, copies: 3 } as never,
    })
    expect(res.json().requestedCopies).toBe(6)
  })

  it('creates one and lists it', async () => {
    expect((await createPreset()).statusCode).toBe(201)
    const list = (await app.inject({ method: 'GET', url: '/api/print-presets' })).json()
    expect(list.presets).toHaveLength(1)
    expect(list.presets[0]).toMatchObject({ name: '设备标签预设', copies: 1 })
  })

  it('refuses a name already in use', async () => {
    await createPreset()
    expect((await createPreset()).statusCode).toBe(409)
  })

  it('refuses to name a design that does not exist', async () => {
    expect((await createPreset({ templateId: 'nope' })).statusCode).toBe(404)
  })

  it('refuses to name a printer that does not exist', async () => {
    expect((await createPreset({ printerId: 'nope' })).statusCode).toBe(404)
  })

  it('can be repointed without the caller knowing', async () => {
    // The whole reason it is a stable id: the design behind it may be revised.
    const id = (await createPreset()).json().id as string
    const other = await seedTemplate('${mac}', '另一个设计')
    const res = await app.inject({ method: 'PATCH', url: `/api/print-presets/${id}`, payload: { templateId: other } })
    expect(res.json().templateId).toBe(other)
  })

  it('is deleted without ceremony', async () => {
    // It holds no data of its own; every label it produced is still in history.
    const id = (await createPreset()).json().id as string
    expect((await app.inject({ method: 'DELETE', url: `/api/print-presets/${id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/print-presets' })).json().presets).toHaveLength(0)
  })
})

describe('printing through one', () => {
  it('accepts a batch and answers like any other submission', async () => {
    const id = (await createPreset()).json().id as string
    const res = await print(id, envelope(ROWS))

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body).toMatchObject({ status: 'queued', requestedCopies: 2, deduplicated: false })
    expect(typeof body.jobId).toBe('string')
    expect(Array.isArray(body.seqClaims)).toBe(true)
    expect(Array.isArray(body.overflowWarnings)).toBe(true)
  })

  it('is polled at the ordinary job endpoint', async () => {
    // A second status endpoint for jobs that arrived this way would be a
    // second thing to keep in step with the first.
    const id = (await createPreset()).json().id as string
    const jobId = (await print(id, envelope(ROWS))).json().jobId as string
    const job = await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })
    expect(job.statusCode).toBe(200)
    expect(job.json().requestedCopies).toBe(2)
  })

  it('resolves the design against the rows it was handed', async () => {
    const id = (await createPreset()).json().id as string
    const jobId = (await print(id, envelope(ROWS))).json().jobId as string
    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    // The snapshot holds the resolved rows, so a reprint reproduces this paper.
    expect(JSON.stringify(job.snapshot)).toContain('001A2B3C4D5E')
  })

  it('multiplies by the preset copies', async () => {
    const id = (await createPreset({ copies: 3 })).json().id as string
    expect((await print(id, envelope(ROWS))).json().requestedCopies).toBe(6)
  })

  it('stores nothing as a data source', async () => {
    // The rows are a batch, not a table somebody now has to maintain.
    const id = (await createPreset()).json().id as string
    await print(id, envelope(ROWS))
    expect((await app.inject({ method: 'GET', url: '/api/data-sources' })).json().dataSources).toHaveLength(0)
  })

  it('leaves the design bound to nothing, as it was', async () => {
    const id = (await createPreset()).json().id as string
    await print(id, envelope(ROWS))
    const template = (await app.inject({ method: 'GET', url: `/api/templates/${templateId}` })).json()
    expect(template.dataSourceId).toBeNull()
  })
})

describe('not printing twice', () => {
  it('returns the same job for a repeated key', async () => {
    // A double click must not become a second batch of stock.
    const id = (await createPreset()).json().id as string
    const first = (await print(id, envelope(ROWS), 'test-1')).json()
    const second = (await print(id, envelope(ROWS), 'test-1')).json()

    expect(second.jobId).toBe(first.jobId)
    expect(second.deduplicated).toBe(true)
  })

  it('treats a different key as a different batch', async () => {
    const id = (await createPreset()).json().id as string
    const first = (await print(id, envelope(ROWS), 'test-1')).json()
    const second = (await print(id, envelope(ROWS), 'test-2')).json()
    expect(second.jobId).not.toBe(first.jobId)
  })

  it('still accepts a request with no key at all', async () => {
    const id = (await createPreset()).json().id as string
    expect((await print(id, envelope(ROWS))).statusCode).toBe(202)
  })
})

describe('what it refuses', () => {
  it('a batch the design has no values for, naming the column', async () => {
    // "This design needs `batch` and your rows do not have it" is something
    // the calling system can put in front of a person; a bare code is not.
    const id = (await createPreset({ templateId: await seedTemplate('${batch}', '要 batch 的设计'), name: '另一个预设' }))
      .json().id as string
    const res = await print(id, envelope(ROWS))

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('VARIABLE_NOT_DEFINED')
    expect(res.json().details.references).toEqual(['batch'])
  })

  it('a batch beyond the label ceiling, without splitting it', async () => {
    const id = (await createPreset({ copies: 2 })).json().id as string
    const many = Array.from({ length: 501 }, (_unused, index) => ({
      mac: `00${index}`, sn: `SN-${index}`,
    }))
    const res = await print(id, envelope(many))
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'BATCH_TOO_LARGE', details: { requested: 1002 } })
  })

  it('a batch for a paused printer', async () => {
    const id = (await createPreset()).json().id as string
    await app.inject({ method: 'PATCH', url: `/api/printers/${printerId}/queue`, payload: { queueState: 'paused' } })
    expect((await print(id, envelope(ROWS))).statusCode).toBe(409)
  })

  it('a batch for a printer nobody has probed', async () => {
    const unprobed = seedPrinter(false)
    const id = (await createPreset({ printerId: unprobed, name: '未探测预设' })).json().id as string
    expect((await print(id, envelope(ROWS))).statusCode).toBe(422)
  })

  it('an envelope whose rows do not match its columns', async () => {
    const id = (await createPreset()).json().id as string
    const res = await print(id, { columns: ['mac', 'sn'], rows: [{ mac: '001A' }] })
    expect(res.statusCode).toBe(400)
  })

  it('a preset that does not exist', async () => {
    expect((await print('nope', envelope(ROWS))).statusCode).toBe(404)
  })
})

describe('serial numbers', () => {
  it('mints them and reports the span, rather than refusing', async () => {
    // The numbers live here, not upstream. Not saying which ones were used is
    // how two systems end up with two independent runs of serials.
    const pool = (
      await app.inject({ method: 'POST', url: '/api/sequence-pools', payload: { name: '整机流水', digits: 6, step: 1 } })
    ).json()
    const withSerial = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '带流水的设计', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
        elements: [
          {
            id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 44, heightMm: 6,
            content: '${mac} ${sn_no}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
          },
        ],
        variables: [{ name: 'sn_no', kind: 'sequence', poolId: pool.id }],
        dataSourceId: null,
      },
    })
    const id = (await createPreset({ templateId: withSerial.json().id, name: '流水预设' })).json().id as string

    const body = (await print(id, envelope(ROWS))).json()
    expect(body.seqClaims).toHaveLength(1)
    expect(body.seqClaims[0]).toMatchObject({ variableName: 'sn_no', start: 1, end: 2 })
  })
})
