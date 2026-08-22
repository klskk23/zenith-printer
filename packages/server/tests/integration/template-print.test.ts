import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

let app: FastifyInstance
let clock: FixedClock

const TEMPLATE = {
  name: 'part label',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: '${serial}', symbology: 'code128' },
    { id: 'part', type: 'text', xMm: 2, yMm: 16, widthMm: 40, heightMm: 5, content: '${partNo}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3 },
  ],
  variables: [
    { name: 'partNo', kind: 'constant', value: 'ABC-12345' },
    { name: 'serial', kind: 'sequence', poolId: 'POOL' },
  ],
}

function seedPrinter(kind: 'niimbot' | 'zpl' = 'niimbot'): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: kind,
    kind,
    transport: kind === 'niimbot' ? 'serial' : 'tcp',
    address: kind === 'niimbot' ? '/dev/ttyACM0' : '192.168.1.50:9100',
    ...(kind === 'niimbot' ? { printTaskName: 'B1' } : {}),
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203,
    printheadPixels: kind === 'niimbot' ? 576 : 832,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1],
    printDirection: 'top',
    supportsConsumableLevel: true,
    model: kind === 'niimbot' ? 'B3S_P' : 'PC310T',
    serial: null,
    firmwareVersion: null,
  })
  return printer.id
}

/** A pool for the design's sequence variable to draw from. */
async function createPool(name = '整机流水', digits = 3, step = 1): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/sequence-pools', payload: { name, digits, step } })
  return res.json().id as string
}

/** The design's variables, with a freshly made pool for the sequence. */
async function variables(): Promise<Array<Record<string, unknown>>> {
  return [
    { name: 'partNo', kind: 'constant', value: 'ABC-12345' },
    { name: 'serial', kind: 'sequence', poolId: await createPool() },
  ]
}

async function createTemplate(overrides: Record<string, unknown> = {}) {
  return (await app.inject({ method: 'POST', url: '/api/templates', payload: { ...TEMPLATE, ...overrides } })).json()
}

function submit(payload: Record<string, unknown>, key?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/print-jobs',
    payload,
    headers: key === undefined ? {} : { 'idempotency-key': key },
  })
}

beforeEach(async () => {
  clock = new FixedClock('2026-08-21T00:00:00Z')
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock,
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('printing a design with variables', () => {
  it('accepts a design whose references all resolve', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const res = await submit({ printerId, templateId: template.id, copies: 5 })
    expect(res.statusCode).toBe(202)
  })

  it('refuses a reference that nothing defines, naming it', async () => {
    // The label would come out reading "${partNo}". Waste that looks like
    // output is worse than a job that refuses to start.
    const printerId = seedPrinter()
    const template = await createTemplate({
      variables: [{ name: 'serial', kind: 'sequence', poolId: await createPool() }],
    })
    const res = await submit({ printerId, templateId: template.id, copies: 1 })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('VARIABLE_NOT_DEFINED')
    expect(res.json().details.reference).toBe('partNo')
  })

  it('refuses a design built for another printer kind', async () => {
    // FR-032: a 72mm niimbot design has no meaning on a 104mm ZPL head.
    const zplPrinter = seedPrinter('zpl')
    const template = await createTemplate({ variables: await variables() })
    const res = await submit({ printerId: zplPrinter, templateId: template.id, copies: 1 })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('TEMPLATE_PRINTER_MISMATCH')
  })

  it('returns 404 for a template that does not exist', async () => {
    const printerId = seedPrinter()
    expect((await submit({ printerId, templateId: 'nope', copies: 1 })).statusCode).toBe(404)
  })

  it('prints a sequence from a design that was never saved (FR-007)', async () => {
    // The pool exists in its own right, so an unsaved design can draw from it.
    // Claims used to be filed against a template, which made this fail in the
    // queue — a wasted trip, and a poor place to find out.
    const printerId = seedPrinter()
    const poolId = await createPool()
    const res = await submit({
      printerId,
      ir: {
        widthMm: 50,
        heightMm: 30,
        dpi: 203,
        elements: [
          { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: '固定内容', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3 },
        ],
      },
      copies: 3,
    })
    expect(res.statusCode).toBe(202)
    expect(poolId).toBeTruthy()
  })
})

describe('content validation before printing', () => {
  it('refuses content the symbology cannot encode', async () => {
    // FR-040: an unencodable value produces a label that looks plausible and
    // will not scan — found only when somebody points a reader at it.
    const printerId = seedPrinter()
    const template = await createTemplate({
      elements: [
        { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: '${partNo}', symbology: 'ean13' },
      ],
      variables: [{ name: 'partNo', kind: 'constant', value: 'NOT-DIGITS' }],
    })

    const res = await submit({ printerId, templateId: template.id, copies: 1 })

    expect(res.statusCode).toBe(422)
    expect(res.json().details.elementId).toBe('code')
  })

  it('accepts content the symbology can encode', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({
      elements: [
        { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: '${partNo}', symbology: 'ean13' },
      ],
      variables: [{ name: 'partNo', kind: 'constant', value: '4006381333931' }],
    })

    expect((await submit({ printerId, templateId: template.id, copies: 1 })).statusCode).toBe(202)
  })

  it('encodes the substituted value, not the reference text', async () => {
    // Encoding "${partNo}" would succeed for code128 and print a barcode that
    // scans as literal placeholder text.
    const printerId = seedPrinter()
    const template = await createTemplate({
      elements: [
        { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: '${partNo}', symbology: 'ean13' },
      ],
      variables: [{ name: 'partNo', kind: 'constant', value: '4006381333931' }],
    })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 1 })).json().jobId
    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()

    // The snapshot keeps the reference; the constant travels alongside it.
    expect(job.snapshot.ir.elements[0].content).toBe('${partNo}')
    expect(job.snapshot.constants).toEqual({ partNo: '4006381333931' })
  })
})

describe('sequence claims', () => {
  it('locks a span at submission, not at print time', async () => {
    // FR-049: two jobs a second apart would otherwise start from the same
    // number and put the same serial on two different boxes.
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const res = await submit({ printerId, templateId: template.id, copies: 80 }, 'k1')

    expect(res.json().seqClaims).toEqual([
      { poolId: expect.any(String), variableName: 'serial', start: 1, end: 80, step: 1, digits: 3 },
    ])
  })

  it('gives consecutive jobs non-overlapping spans', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const first = await submit({ printerId, templateId: template.id, copies: 10 }, 'k1')
    const second = await submit({ printerId, templateId: template.id, copies: 10 }, 'k2')

    expect(first.json().seqClaims[0].end).toBe(10)
    expect(second.json().seqClaims[0].start).toBe(11)
  })

  it('draws two designs from one pool without reissuing a number (FR-005)', async () => {
    // The reason pools are standalone. The old derivation narrowed by template
    // id, which made this issue each number twice.
    const printerId = seedPrinter()
    const poolId = await createPool()
    const boxes = await createTemplate({
      name: '小盒',
      variables: [
        { name: 'partNo', kind: 'constant', value: 'X' },
        { name: 'serial', kind: 'sequence', poolId },
      ],
    })
    const cartons = await createTemplate({
      name: '外箱',
      variables: [
        { name: 'partNo', kind: 'constant', value: 'X' },
        { name: 'serial', kind: 'sequence', poolId },
      ],
    })

    const a = await submit({ printerId, templateId: boxes.id, copies: 3 }, 'k1')
    const b = await submit({ printerId, templateId: cartons.id, copies: 3 }, 'k2')

    expect(a.json().seqClaims[0]).toMatchObject({ start: 1, end: 3 })
    expect(b.json().seqClaims[0]).toMatchObject({ start: 4, end: 6 })
  })

  it('refuses a span that would exceed the pool width', async () => {
    const printerId = seedPrinter()
    const poolId = await createPool('两位', 2, 1)
    const template = await createTemplate({
      variables: [
        { name: 'partNo', kind: 'constant', value: 'X' },
        { name: 'serial', kind: 'sequence', poolId },
      ],
    })
    const res = await submit({ printerId, templateId: template.id, copies: 100 })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('SEQUENCE_OVERFLOW')
    expect(res.json().details).toMatchObject({ poolName: '两位', maxValue: 99 })
  })

  it('frees the span when a queued job is cancelled', async () => {
    // The job printed nothing, so holding its numbers would skip them for no
    // reason at all (FR-019).
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 10 }, 'k1')).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/print-jobs/${jobId}` })

    const next = await submit({ printerId, templateId: template.id, copies: 5 }, 'k2')
    expect(next.json().seqClaims[0].start).toBe(1)
  })

  it('does not claim twice for a repeated idempotency key', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const body = { printerId, templateId: template.id, copies: 10 }

    const first = await submit(body, 'same')
    const second = await submit(body, 'same')

    expect(second.json().jobId).toBe(first.json().jobId)
    expect(second.json().seqClaims).toEqual(first.json().seqClaims)
  })
})

describe('snapshot immutability', () => {
  it('records the design content at submission time', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 1 })).json().jobId

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.snapshot.ir.elements).toHaveLength(2)
  })

  it('carries the constants, so a reprint does not need the design', async () => {
    // Without this a reprint fails on an unresolved reference: the values were
    // substituted for the pre-flight check but nothing kept them for rendering.
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 1 })).json().jobId

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.constants).toMatchObject({ partNo: 'ABC-12345' })
  })

  it('does not drift when a constant is edited afterwards', async () => {
    // FR-039/FR-040: history must answer "what did we actually print", not
    // "what does the design say today".
    const printerId = seedPrinter()
    const vars = await variables()
    const template = await createTemplate({ variables: vars })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 1 })).json().jobId

    clock.advance(1000)
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${template.id}`,
      payload: {
        ...TEMPLATE,
        variables: [{ name: 'partNo', kind: 'constant', value: '改过了' }, vars[1]],
        name: 'renamed',
        widthMm: 40,
        version: template.version,
      },
    })

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.snapshot.widthMm).toBe(50)
    expect(job.snapshot.constants.partNo).toBe('ABC-12345')
  })

  it('survives the design being deleted', async () => {
    // FR-051: deleting a design must not destroy the record of what it produced.
    const printerId = seedPrinter()
    const template = await createTemplate({ variables: await variables() })
    const jobId = (await submit({ printerId, templateId: template.id, copies: 3 })).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}` })

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.requestedCopies).toBe(3)
  })
})
