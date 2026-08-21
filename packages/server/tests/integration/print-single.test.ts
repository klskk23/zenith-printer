import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { B3SP_METADATA } from '../support/fake-niimbot-client.ts'

let app: FastifyInstance

const IR = {
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    {
      id: 'b',
      type: 'barcode',
      xMm: 2,
      yMm: 2,
      widthMm: 40,
      heightMm: 12,
      content: 'ABC-12345',
      symbology: 'code128',
    },
  ],
}

async function seedPrinter(probed = true): Promise<string> {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'warehouse',
    kind: 'niimbot',
    transport: 'serial',
    address: '/dev/ttyACM0',
    printTaskName: 'B1',
  })
  if (probed) {
    repo.saveCapabilities(printer.id, {
      dpi: B3SP_METADATA.dpi,
      printheadPixels: B3SP_METADATA.printheadPixels,
      densityMin: B3SP_METADATA.densityMin,
      densityMax: B3SP_METADATA.densityMax,
      densityDefault: B3SP_METADATA.densityDefault,
      paperTypes: B3SP_METADATA.paperTypes,
      printDirection: 'top',
      supportsConsumableLevel: true,
      model: 'B3S_P',
      serial: 'H508010165',
      firmwareVersion: '0x030f',
    })
  }
  return printer.id
}

function submit(payload: Record<string, unknown>, idempotencyKey?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/print-jobs',
    payload,
    headers: idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey },
  })
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    // These tests cover the submission contract, not execution. Leaving the
    // runner on would let jobs finish before the assertions look at them.
    // Queue behaviour has its own suite.
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('submission', () => {
  it('accepts an ad-hoc label without any saved template', async () => {
    // The path that lets User Story 1 ship before templates exist: design,
    // print, done — nothing has to be saved first.
    const printerId = await seedPrinter()
    const res = await submit({ printerId, ir: IR, copies: 1 })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ status: 'queued', requestedCopies: 1 })
    expect(typeof res.json().jobId).toBe('string')
  })

  it('returns immediately rather than waiting for the printer', async () => {
    // FR-012: nobody should hold a tab open while labels come out.
    const printerId = await seedPrinter()
    const res = await submit({ printerId, ir: IR, copies: 100 })
    expect(res.statusCode).toBe(202)
    expect(res.json().status).toBe('queued')
  })

  it('refuses both a template id and an ad-hoc IR', async () => {
    const printerId = await seedPrinter()
    const res = await submit({ printerId, ir: IR, templateId: 't1', copies: 1 })
    expect(res.statusCode).toBe(400)
  })

  it('refuses neither', async () => {
    const printerId = await seedPrinter()
    expect((await submit({ printerId, copies: 1 })).statusCode).toBe(400)
  })

  it('rejects a copy count above the supported batch size', async () => {
    const printerId = await seedPrinter()
    expect((await submit({ printerId, ir: IR, copies: 101 })).statusCode).toBe(400)
  })

  it('returns 404 for an unknown printer', async () => {
    expect((await submit({ printerId: 'nope', ir: IR, copies: 1 })).statusCode).toBe(404)
  })
})

describe('idempotency', () => {
  it('returns the same job for a repeated key', async () => {
    // FR-017: a refresh must not produce a second physical batch.
    const printerId = await seedPrinter()
    const first = await submit({ printerId, ir: IR, copies: 5 }, 'key-1')
    const second = await submit({ printerId, ir: IR, copies: 5 }, 'key-1')

    expect(first.json().jobId).toBe(second.json().jobId)
    expect(second.json().deduplicated).toBe(true)
  })

  it('creates only one job row for a repeated key', async () => {
    const printerId = await seedPrinter()
    await submit({ printerId, ir: IR, copies: 5 }, 'key-1')
    await submit({ printerId, ir: IR, copies: 5 }, 'key-1')

    const list = await app.inject({ method: 'GET', url: '/api/print-jobs' })
    expect(list.json().jobs).toHaveLength(1)
  })

  it('treats different keys as different jobs', async () => {
    const printerId = await seedPrinter()
    const first = await submit({ printerId, ir: IR, copies: 1 }, 'key-1')
    const second = await submit({ printerId, ir: IR, copies: 1 }, 'key-2')
    expect(first.json().jobId).not.toBe(second.json().jobId)
  })

  it('still accepts a submission with no key at all', async () => {
    const printerId = await seedPrinter()
    expect((await submit({ printerId, ir: IR, copies: 1 })).statusCode).toBe(202)
  })
})

describe('validation against probed capabilities', () => {
  it('refuses a canvas wider than the printhead', async () => {
    // FR-005: 576 dots at 203 dpi is 72.1mm; anything wider loses its right
    // edge with no error from the device.
    const printerId = await seedPrinter()
    const res = await submit({ printerId, ir: { ...IR, widthMm: 90 }, copies: 1 })

    expect(res.statusCode).toBe(422)
    expect(res.json().details.maxLabelWidthMm).toBeCloseTo(72.071, 2)
  })

  it('accepts a canvas exactly at the limit', async () => {
    const printerId = await seedPrinter()
    expect((await submit({ printerId, ir: { ...IR, widthMm: 72 }, copies: 1 })).statusCode).toBe(202)
  })

  it('refuses a printer that has never been probed', async () => {
    // Without capabilities there is nothing to validate the design against.
    const printerId = await seedPrinter(false)
    expect((await submit({ printerId, ir: IR, copies: 1 })).statusCode).toBe(422)
  })

  it('refuses while the queue is paused', async () => {
    const printerId = await seedPrinter()
    await app.inject({
      method: 'PATCH',
      url: `/api/printers/${printerId}/queue`,
      payload: { queueState: 'paused' },
    })
    const res = await submit({ printerId, ir: IR, copies: 1 })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('QUEUE_PAUSED')
  })
})

describe('snapshot', () => {
  it('records what was printed, independent of the printer record', async () => {
    // FR-050: history must stay readable after the printer is deleted.
    const printerId = await seedPrinter()
    const jobId = (await submit({ printerId, ir: IR, copies: 2 })).json().jobId

    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot).toMatchObject({
      printerName: 'warehouse',
      printerModel: 'B3S_P',
      widthMm: 50,
      heightMm: 30,
      dpi: 203,
    })
    expect(job.snapshot.ir.elements).toHaveLength(1)
  })

  it('falls back to the probed default density when no profile is chosen', async () => {
    const printerId = await seedPrinter()
    const jobId = (await submit({ printerId, ir: IR, copies: 1 })).json().jobId
    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.snapshot.profile.density).toBe(3)
  })

  it('starts with a known page count of zero, not unknown', async () => {
    // null is reserved for "a crash left this unverifiable" (FR-053).
    const printerId = await seedPrinter()
    const jobId = (await submit({ printerId, ir: IR, copies: 4 })).json().jobId
    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.pagesPrinted).toBe(0)
  })
})

describe('cancellation', () => {
  it('cancels a queued job', async () => {
    const printerId = await seedPrinter()
    const jobId = (await submit({ printerId, ir: IR, copies: 1 })).json().jobId

    expect((await app.inject({ method: 'DELETE', url: `/api/print-jobs/${jobId}` })).statusCode).toBe(204)
    const job = (await app.inject({ method: 'GET', url: `/api/print-jobs/${jobId}` })).json()
    expect(job.status).toBe('cancelled')
  })

  it('refuses to cancel a job already printing', async () => {
    // FR-019: labels coming out cannot be recalled, and stopping mid-run would
    // leave the printed count unverifiable.
    const printerId = await seedPrinter()
    const jobId = (await submit({ printerId, ir: IR, copies: 1 })).json().jobId
    app.ctx.db.prepare("UPDATE print_jobs SET status = 'printing' WHERE id = ?").run(jobId)

    const res = await app.inject({ method: 'DELETE', url: `/api/print-jobs/${jobId}` })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('JOB_ALREADY_PRINTING')
  })

  it('returns 404 for an unknown job', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/print-jobs/nope' })).statusCode).toBe(404)
  })
})
