import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterUnreachableError } from '../../src/drivers/port.ts'
import * as factory from '../../src/drivers/factory.ts'
import { B3SP_METADATA } from '../support/fake-niimbot-client.ts'

let app: FastifyInstance

const NIIMBOT = {
  name: 'warehouse',
  kind: 'niimbot',
  transport: 'serial',
  address: '/dev/ttyACM0',
  printTaskName: 'B1',
}

const CAPABILITIES = {
  dpi: B3SP_METADATA.dpi,
  printheadPixels: B3SP_METADATA.printheadPixels,
  densityMin: B3SP_METADATA.densityMin,
  densityMax: B3SP_METADATA.densityMax,
  densityDefault: B3SP_METADATA.densityDefault,
  paperTypes: B3SP_METADATA.paperTypes,
  printDirection: 'top' as const,
  supportsConsumableLevel: true,
  model: 'B3S_P',
  serial: 'H508010165',
  firmwareVersion: '0x030f',
}

/** Replace the driver factory so no test touches a serial port. */
function stubDriver(overrides: Partial<Record<'connect' | 'probe' | 'disconnect', () => Promise<unknown>>> = {}) {
  const disconnect = vi.fn(overrides.disconnect ?? (async () => undefined))
  vi.spyOn(factory, 'createDriver').mockReturnValue({
    kind: 'niimbot',
    connect: overrides.connect ?? (async () => undefined),
    probe: overrides.probe ?? (async () => CAPABILITIES),
    disconnect,
    preflight: async () => ({ ok: true, remainingLabels: null, blockers: [] }),
    printPages: async () => undefined,
  } as never)
  return { disconnect }
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('prn'),
    logLevel: 'error',
  })
  await app.ready()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await app.close()
})

async function createPrinter(body: Record<string, unknown> = NIIMBOT) {
  return app.inject({ method: 'POST', url: '/api/printers', payload: body })
}

describe('creation', () => {
  it('stores only what the operator supplied', async () => {
    const res = await createPrinter()
    expect(res.statusCode).toBe(201)
    const printer = res.json()
    expect(printer).toMatchObject({ id: 'prn-0001', name: 'warehouse', address: '/dev/ttyACM0' })
    // Capabilities stay empty until a probe runs (FR-025).
    expect(printer.capabilities).toBeNull()
  })

  it('requires a print task for a niimbot printer', async () => {
    const withoutTask: Record<string, unknown> = { ...NIIMBOT }
    delete withoutTask.printTaskName
    const res = await createPrinter(withoutTask)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_FAILED')
  })

  it('does not require one for a zpl printer', async () => {
    const res = await createPrinter({
      name: 'shipping',
      kind: 'zpl',
      transport: 'tcp',
      address: '192.168.1.50:9100',
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejects an unknown printer kind', async () => {
    expect((await createPrinter({ ...NIIMBOT, kind: 'dymo' })).statusCode).toBe(400)
  })

  it('lists what was created', async () => {
    await createPrinter()
    const res = await app.inject({ method: 'GET', url: '/api/printers' })
    expect(res.json().printers).toHaveLength(1)
  })
})

describe('probing', () => {
  it('fills in the capabilities the device reported', async () => {
    stubDriver()
    await createPrinter()
    const res = await app.inject({ method: 'POST', url: '/api/printers/prn-0001/probe' })

    expect(res.statusCode).toBe(200)
    expect(res.json().capabilities).toMatchObject({
      dpi: 203,
      printheadPixels: 576,
      densityMax: 5,
      supportsConsumableLevel: true,
    })
    expect(res.json().lastProbedAt).toBe('2026-08-21T00:00:00.000Z')
  })

  it('returns 503 when the device cannot be reached', async () => {
    // FR-047: an unreachable printer is its own failure class, because it is
    // the only one that needs somebody to walk over to the machine.
    stubDriver({
      connect: async () => {
        throw new PrinterUnreachableError('/dev/ttyACM0')
      },
    })
    await createPrinter()
    const res = await app.inject({ method: 'POST', url: '/api/printers/prn-0001/probe' })

    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('PRINTER_UNREACHABLE')
    expect(res.json().next).toContain('设备旁')
  })

  it('releases the connection even when probing fails', async () => {
    const { disconnect } = stubDriver({
      probe: async () => {
        throw new Error('probe failed')
      },
    })
    await createPrinter()
    await app.inject({ method: 'POST', url: '/api/printers/prn-0001/probe' })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('returns 404 for a printer that does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/printers/nope/probe' })
    expect(res.statusCode).toBe(404)
  })
})

describe('queue state', () => {
  it('pauses and resumes', async () => {
    await createPrinter()
    const paused = await app.inject({
      method: 'PATCH',
      url: '/api/printers/prn-0001/queue',
      payload: { queueState: 'paused' },
    })
    expect(paused.json().queueState).toBe('paused')

    const resumed = await app.inject({
      method: 'PATCH',
      url: '/api/printers/prn-0001/queue',
      payload: { queueState: 'running' },
    })
    expect(resumed.json().queueState).toBe('running')
  })

  it('rejects an unknown queue state', async () => {
    await createPrinter()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/printers/prn-0001/queue',
      payload: { queueState: 'sideways' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('deletion', () => {
  it('removes a printer with an empty queue', async () => {
    await createPrinter()
    expect((await app.inject({ method: 'DELETE', url: '/api/printers/prn-0001' })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/printers' })).json().printers).toHaveLength(0)
  })

  it('refuses while jobs are still queued, and keeps the printer', async () => {
    // FR-052: deleting would orphan work that has not printed yet.
    await createPrinter()
    app.ctx.db
      .prepare(
        `INSERT INTO print_jobs (id, idempotency_key, printer_id, requested_copies, status, snapshot, created_at)
         VALUES ('j1', 'k1', 'prn-0001', 5, 'queued', '{}', '2026-08-21T00:00:00Z')`,
      )
      .run()

    const res = await app.inject({ method: 'DELETE', url: '/api/printers/prn-0001' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('PRINTER_HAS_QUEUED_JOBS')
    expect(res.json().details).toEqual({ queuedJobs: 1 })
    expect((await app.inject({ method: 'GET', url: '/api/printers' })).json().printers).toHaveLength(1)
  })

  it('returns 404 for a printer that does not exist', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/printers/nope' })).statusCode).toBe(404)
  })
})

/**
 * FR-073, end to end. Switching the interface language has to switch the error
 * prose with it, or the UI is half translated and the errors are the half left
 * behind — which is the half that matters when something goes wrong.
 */
describe('error language', () => {
  const hasHan = (text: string): boolean => /[一-鿿]/.test(text)

  it('answers in Chinese by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printers/nope' })
    expect(hasHan(res.json().what)).toBe(true)
  })

  it('answers in English when the client asks for it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/printers/nope',
      headers: { 'accept-language': 'en-US' },
    })
    expect(res.json().what.length).toBeGreaterThan(0)
    expect(hasHan(res.json().what)).toBe(false)
  })

  it('keeps the code and status identical across languages', async () => {
    const zh = await app.inject({ method: 'GET', url: '/api/printers/nope' })
    const en = await app.inject({
      method: 'GET',
      url: '/api/printers/nope',
      headers: { 'accept-language': 'en-US' },
    })
    expect(en.statusCode).toBe(zh.statusCode)
    expect(en.json().code).toBe(zh.json().code)
  })

  it('localises validation failures too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers',
      headers: { 'accept-language': 'en-US' },
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(hasHan(res.json().what)).toBe(false)
  })

  it('falls back to Chinese for a language it does not have', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/printers/nope',
      headers: { 'accept-language': 'fr-FR' },
    })
    expect(hasHan(res.json().what)).toBe(true)
  })
})

/**
 * The calibration page.
 *
 * The earlier test here checked only that an unconfirmed request is refused —
 * it asserted the guard and never the action, so an endpoint that built the
 * label and returned it without printing anything passed cleanly. These check
 * that a job actually comes out the other end.
 */
describe('calibration page', () => {
  async function readyPrinter(): Promise<string> {
    const printer = (await createPrinter()).json()
    app.ctx.db
      .prepare(
        `UPDATE printers SET dpi = 203, printhead_pixels = 384, density_min = 1, density_max = 5,
           density_default = 3, paper_types = '[1]', print_direction = 'top',
           supports_consumable_level = 1, model = 'B3S_P', last_probed_at = '2026-08-21T00:00:00Z'
         WHERE id = ?`,
      )
      .run(printer.id)

    // The calibration page must be the size of the paper, so a profile
    // recording that size is a precondition rather than a nicety.
    await app.inject({
      method: 'POST',
      url: `/api/printers/${printer.id}/profiles`,
      payload: {
        name: 'stock', density: 3, labelType: 1,
        labelWidthMm: 50, labelHeightMm: 30, isDefault: true,
      },
    })
    return printer.id
  }

  const jobCount = (): number =>
    Number(
      (app.ctx.db.prepare('SELECT COUNT(*) AS n FROM print_jobs').get() as { n: number }).n,
    )

  it('refuses without an explicit confirmation', async () => {
    const id = await readyPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('CONFIRMATION_REQUIRED')
  })

  it('prints nothing when it refuses', async () => {
    const id = await readyPrinter()
    await app.inject({ method: 'POST', url: `/api/printers/${id}/calibration-page`, payload: {} })
    expect(jobCount()).toBe(0)
  })

  /** The one the previous version of this file did not ask. */
  it('actually queues a job when confirmed', async () => {
    const id = await readyPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json().jobId).toBeTruthy()
    expect(jobCount()).toBe(1)
  })

  it('queues exactly one label, not a batch', async () => {
    const id = await readyPrinter()
    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    const job = app.ctx.db.prepare('SELECT requested_copies FROM print_jobs').get() as {
      requested_copies: number
    }
    expect(Number(job.requested_copies)).toBe(1)
  })

  it('records a snapshot carrying the calibration label itself', async () => {
    const id = await readyPrinter()
    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    const row = app.ctx.db.prepare('SELECT snapshot FROM print_jobs').get() as { snapshot: string }
    const snapshot = JSON.parse(row.snapshot)
    // A centre cross and edge ticks: what the measurement is taken against.
    expect(snapshot.ir.elements.length).toBeGreaterThan(10)
  })

  it('refuses on a paused queue rather than silently doing nothing', async () => {
    const id = await readyPrinter()
    await app.inject({
      method: 'PATCH',
      url: `/api/printers/${id}/queue`,
      payload: { queueState: 'paused' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    expect(res.statusCode).toBe(409)
    expect(jobCount()).toBe(0)
  })

  it('404s for a printer that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers/nope/calibration-page',
      payload: { confirmed: true },
    })
    expect(res.statusCode).toBe(404)
  })
})

/**
 * The calibration page has to be the size of the paper.
 *
 * It is measured against the edges of the label, so a page that is not the
 * size of the label cannot be measured at all. This used to fall back to the
 * printhead's full width when no profile said otherwise, which on a 50 mm roll
 * means printing 104 mm: a wasted label, and most of it missing.
 */
describe('calibration page size', () => {
  async function readyPrinter(): Promise<string> {
    const printer = (await createPrinter()).json()
    app.ctx.db
      .prepare(
        `UPDATE printers SET dpi = 203, printhead_pixels = 384, density_min = 1, density_max = 5,
           density_default = 3, paper_types = '[1]', print_direction = 'top',
           supports_consumable_level = 1, model = 'B3S_P', last_probed_at = '2026-08-21T00:00:00Z'
         WHERE id = ?`,
      )
      .run(printer.id)
    return printer.id
  }

  async function addProfile(
    printerId: string,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${printerId}/profiles`,
      payload: {
        name: 'stock',
        density: 3,
        labelType: 1,
        labelWidthMm: 50,
        labelHeightMm: 30,
        isDefault: true,
        ...over,
      },
    })
    return res.json()
  }

  const snapshotOf = (): { widthMm: number; heightMm: number } => {
    const row = app.ctx.db.prepare('SELECT snapshot FROM print_jobs').get() as { snapshot: string }
    return JSON.parse(row.snapshot).ir
  }

  it('refuses when nothing records a stock size', async () => {
    const id = await readyPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CALIBRATION_STOCK_UNKNOWN')
  })

  it('burns no label when it refuses', async () => {
    const id = await readyPrinter()
    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    const count = app.ctx.db.prepare('SELECT COUNT(*) AS n FROM print_jobs').get() as { n: number }
    expect(Number(count.n)).toBe(0)
  })

  it('says what to do about it', async () => {
    const id = await readyPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    expect(res.json().next.length).toBeGreaterThan(0)
  })

  it('uses the default profile stock', async () => {
    const id = await readyPrinter()
    await addProfile(id, { labelWidthMm: 50, labelHeightMm: 30 })
    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    expect(snapshotOf()).toMatchObject({ widthMm: 50, heightMm: 30 })
  })

  it('uses the profile it was asked for, not the default', async () => {
    const id = await readyPrinter()
    await addProfile(id, { name: 'wide', labelWidthMm: 50, labelHeightMm: 30 })
    const narrow = await addProfile(id, {
      name: 'narrow', labelWidthMm: 40, labelHeightMm: 20, isDefault: false,
    })

    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true, profileId: narrow.id },
    })

    expect(snapshotOf()).toMatchObject({ widthMm: 40, heightMm: 20 })
  })

  it('never falls back to the printhead width', async () => {
    // 384 dots at 203 dpi is 48 mm — the value the old fallback produced.
    const id = await readyPrinter()
    await addProfile(id, { labelWidthMm: 50, labelHeightMm: 30 })
    await app.inject({
      method: 'POST',
      url: `/api/printers/${id}/calibration-page`,
      payload: { confirmed: true },
    })
    expect(snapshotOf().widthMm).not.toBeCloseTo(48, 1)
  })
})
