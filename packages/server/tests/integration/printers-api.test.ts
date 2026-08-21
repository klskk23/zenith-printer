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
