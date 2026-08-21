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
    { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: { $var: 'serial' }, symbology: 'code128' },
    { id: 'part', type: 'text', xMm: 2, yMm: 16, widthMm: 40, heightMm: 5, content: { $var: 'partNo' }, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3 },
  ],
  variableFields: [
    { name: 'partNo', label: 'Part', source: 'manual', sampleValue: 'ABC-12345' },
    { name: 'serial', label: 'Serial', source: 'sequence', seqStart: 1, seqDigits: 3, seqStep: 1 },
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

describe('printing from a template', () => {
  it('accepts a job that supplies every manual field', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate()
    const res = await submit({
      printerId,
      templateId: template.id,
      copies: 5,
      manualFieldValues: { partNo: 'XYZ-999' },
    })
    expect(res.statusCode).toBe(202)
  })

  it('refuses a job missing a manual field', async () => {
    // FR-038: printing a blank where a part number should be wastes the label
    // just as surely as a jam does.
    const printerId = seedPrinter()
    const template = await createTemplate()
    const res = await submit({ printerId, templateId: template.id, copies: 1 })

    expect(res.statusCode).toBe(422)
    expect(res.json().details.missingFields).toEqual(['partNo'])
  })

  it('refuses a template built for another printer kind', async () => {
    // FR-032: a 72mm niimbot design has no meaning on a 104mm ZPL head.
    const zplPrinter = seedPrinter('zpl')
    const template = await createTemplate()
    const res = await submit({
      printerId: zplPrinter,
      templateId: template.id,
      copies: 1,
      manualFieldValues: { partNo: 'X' },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('TEMPLATE_PRINTER_MISMATCH')
  })

  it('returns 404 for a template that does not exist', async () => {
    const printerId = seedPrinter()
    expect((await submit({ printerId, templateId: 'nope', copies: 1 })).statusCode).toBe(404)
  })
})

describe('field validation before printing', () => {
  it('refuses content the symbology cannot encode', async () => {
    // FR-040: an unencodable value produces a label that looks plausible and
    // will not scan — found only when somebody points a reader at it.
    const printerId = seedPrinter()
    const template = await createTemplate({
      elements: [
        { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: { $var: 'partNo' }, symbology: 'ean13' },
      ],
      variableFields: [{ name: 'partNo', label: 'Part', source: 'manual', sampleValue: '4006381333931' }],
    })

    const res = await submit({
      printerId,
      templateId: template.id,
      copies: 1,
      manualFieldValues: { partNo: 'NOT-DIGITS' },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().details.elementId).toBe('code')
  })

  it('accepts content the symbology can encode', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate({
      elements: [
        { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: { $var: 'partNo' }, symbology: 'ean13' },
      ],
      variableFields: [{ name: 'partNo', label: 'Part', source: 'manual', sampleValue: '4006381333931' }],
    })

    const res = await submit({
      printerId,
      templateId: template.id,
      copies: 1,
      manualFieldValues: { partNo: '4006381333931' },
    })
    expect(res.statusCode).toBe(202)
  })
})

describe('sequence claims', () => {
  it('locks a span at submission, not at print time', async () => {
    // FR-049: two jobs a second apart would otherwise start from the same
    // number and put the same serial on two different boxes.
    const printerId = seedPrinter()
    const template = await createTemplate()
    const res = await submit(
      { printerId, templateId: template.id, copies: 80, manualFieldValues: { partNo: 'X' } },
      'k1',
    )
    expect(res.json().seqRanges.serial).toEqual({ start: 1, end: 80, step: 1, digits: 3 })
  })

  it('gives consecutive jobs non-overlapping spans', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate()
    const first = await submit(
      { printerId, templateId: template.id, copies: 10, manualFieldValues: { partNo: 'X' } },
      'k1',
    )
    const second = await submit(
      { printerId, templateId: template.id, copies: 10, manualFieldValues: { partNo: 'X' } },
      'k2',
    )

    expect(first.json().seqRanges.serial.end).toBe(10)
    expect(second.json().seqRanges.serial.start).toBe(11)
  })

  it('honours a user-chosen start', async () => {
    // Reprinting a spoiled batch with its original numbers is legitimate.
    const printerId = seedPrinter()
    const template = await createTemplate()
    const res = await submit({
      printerId,
      templateId: template.id,
      copies: 5,
      manualFieldValues: { partNo: 'X' },
      sequenceOverrides: { serial: 500 },
    })
    expect(res.json().seqRanges.serial).toEqual({ start: 500, end: 504, step: 1, digits: 3 })
  })

  it('refuses rather than wrapping past the configured width', async () => {
    // Wrapping 999 to 000 reissues serials that already exist on labels.
    const printerId = seedPrinter()
    const template = await createTemplate()
    const res = await submit({
      printerId,
      templateId: template.id,
      copies: 5,
      manualFieldValues: { partNo: 'X' },
      sequenceOverrides: { serial: 998 },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('SEQUENCE_OVERFLOW')
    expect(res.json().details).toMatchObject({ fieldName: 'serial', maxValue: 999 })
  })

  it('frees the span when a queued job is cancelled', async () => {
    // The job printed nothing, so holding its numbers would skip them for no
    // reason at all (FR-019).
    const printerId = seedPrinter()
    const template = await createTemplate()
    const jobId = (
      await submit({ printerId, templateId: template.id, copies: 10, manualFieldValues: { partNo: 'X' } }, 'k1')
    ).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/print-jobs/${jobId}` })

    const next = await submit(
      { printerId, templateId: template.id, copies: 5, manualFieldValues: { partNo: 'X' } },
      'k2',
    )
    expect(next.json().seqRanges.serial.start).toBe(1)
  })

  it('does not claim twice for a repeated idempotency key', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate()
    const body = { printerId, templateId: template.id, copies: 10, manualFieldValues: { partNo: 'X' } }

    const first = await submit(body, 'same')
    const second = await submit(body, 'same')

    expect(second.json().jobId).toBe(first.json().jobId)
    expect(second.json().seqRanges).toEqual(first.json().seqRanges)
  })
})

describe('snapshot immutability', () => {
  it('records the template content at submission time', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate()
    const jobId = (
      await submit({ printerId, templateId: template.id, copies: 1, manualFieldValues: { partNo: 'X' } })
    ).json().jobId

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.snapshot.ir.elements).toHaveLength(2)
  })

  it('does not drift when the template is edited afterwards', async () => {
    // FR-050: history must answer "what did we actually print", not "what does
    // the template say today".
    const printerId = seedPrinter()
    const template = await createTemplate()
    const jobId = (
      await submit({ printerId, templateId: template.id, copies: 1, manualFieldValues: { partNo: 'X' } })
    ).json().jobId

    clock.advance(1000)
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${template.id}`,
      payload: { ...TEMPLATE, name: 'renamed', widthMm: 40, updatedAt: template.updatedAt },
    })

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.snapshot.widthMm).toBe(50)
  })

  it('survives the template being deleted', async () => {
    // FR-051: deleting a design must not destroy the record of what it produced.
    const printerId = seedPrinter()
    const template = await createTemplate()
    const jobId = (
      await submit({ printerId, templateId: template.id, copies: 3, manualFieldValues: { partNo: 'X' } })
    ).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/templates/${template.id}` })

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.templateId).toBeNull()
    expect(job.snapshot.templateName).toBe('part label')
    expect(job.requestedCopies).toBe(3)
  })

  it('records the profile values used, not a reference to them', async () => {
    const printerId = seedPrinter()
    const template = await createTemplate()
    const profile = (
      await app.inject({
        method: 'POST',
        url: `/api/printers/${printerId}/profiles`,
        payload: { name: 'thick', density: 5, labelType: 2, labelWidthMm: 50, labelHeightMm: 30 },
      })
    ).json()

    const jobId = (
      await submit({
        printerId,
        templateId: template.id,
        profileId: profile.id,
        copies: 1,
        manualFieldValues: { partNo: 'X' },
      })
    ).json().jobId

    await app.inject({ method: 'DELETE', url: `/api/profiles/${profile.id}` })

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.profile).toMatchObject({ name: 'thick', density: 5, labelType: 2 })
  })
})
