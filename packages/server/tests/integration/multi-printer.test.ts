import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { createDriver, splitAddress } from '../../src/drivers/factory.ts'
import { silentLogger } from '../support/queue-harness.ts'
import { createHarness } from '../support/queue-harness.ts'
import type { Printer } from '../../src/domain/printer.ts'

let app: FastifyInstance

const IR = {
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, content: 'ABC-12345', symbology: 'code128' },
  ],
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('p'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function addPrinter(body: Record<string, unknown>) {
  return (await app.inject({ method: 'POST', url: '/api/printers', payload: body })).json()
}

const NIIMBOT = {
  name: '仓库-精臣',
  kind: 'niimbot',
  transport: 'serial',
  address: '/dev/ttyACM0',
  printTaskName: 'B1',
}

const HONEYWELL = {
  name: '发货-霍尼韦尔',
  kind: 'zpl',
  transport: 'tcp',
  address: '192.168.1.50:9100',
}

describe('address parsing', () => {
  it('splits host and port', () => {
    expect(splitAddress('192.168.1.50:9100')).toEqual(['192.168.1.50', 9100])
  })

  it('falls back to the raw print port when none is given', () => {
    expect(splitAddress('192.168.1.50')).toEqual(['192.168.1.50', undefined])
  })

  it('leaves a malformed port alone rather than guessing', () => {
    expect(splitAddress('printer.local:abc')).toEqual(['printer.local:abc', undefined])
  })
})

describe('driver selection', () => {
  const base: Omit<Printer, 'kind' | 'transport' | 'address' | 'printTaskName'> = {
    id: 'p1',
    name: 'x',
    capabilities: null,
    queueState: 'running',
    queuePausedReason: null,
    lastProbedAt: null,
    createdAt: '2026-08-21T00:00:00Z',
  }

  it('builds a driver for each kind', () => {
    // Under test both come back as dry-run wrappers; what matters is that
    // neither kind is rejected as unsupported.
    const niimbot = { ...base, kind: 'niimbot' as const, transport: 'serial' as const, address: '/dev/x', printTaskName: 'B1' }
    const zpl = { ...base, kind: 'zpl' as const, transport: 'tcp' as const, address: '192.168.1.50:9100' }

    expect(() => createDriver(niimbot, { logger: silentLogger })).not.toThrow()
    expect(() => createDriver(zpl, { logger: silentLogger })).not.toThrow()
  })
})

describe('both kinds through one interface', () => {
  it('accepts a Honeywell printer without a print task', async () => {
    // That field only means something to NIIMBOT; requiring it here would be
    // asking the operator for a value that does not exist.
    const printer = await addPrinter(HONEYWELL)
    expect(printer.kind).toBe('zpl')
    expect(printer.printTaskName).toBeUndefined()
  })

  it('lists both kinds side by side', async () => {
    await addPrinter(NIIMBOT)
    await addPrinter(HONEYWELL)

    const list = (await app.inject({ method: 'GET', url: '/api/printers' })).json().printers
    expect(list.map((p: Printer) => p.kind).sort()).toEqual(['niimbot', 'zpl'])
  })

  it('probes a Honeywell printer into the same capability shape', async () => {
    const printer = await addPrinter(HONEYWELL)
    const probed = (await app.inject({ method: 'POST', url: `/api/printers/${printer.id}/probe` })).json()

    // Same fields as the NIIMBOT side, so nothing above the driver layer has
    // to know which kind it is looking at.
    expect(probed.capabilities).toMatchObject({
      dpi: expect.any(Number),
      printheadPixels: expect.any(Number),
      densityMin: expect.any(Number),
      densityMax: expect.any(Number),
      supportsConsumableLevel: expect.any(Boolean),
    })
  })

  it('offers a wider canvas on the Honeywell head', async () => {
    const printer = await addPrinter(HONEYWELL)
    const probed = (await app.inject({ method: 'POST', url: `/api/printers/${printer.id}/probe` })).json()

    // 832 dots at 203 dpi is 104mm, against 72mm for B3S_P — the reason a
    // template is bound to a printer kind (FR-032).
    expect(probed.capabilities.printheadPixels).toBeGreaterThan(576)
  })

  it('takes the same job submission for either kind', async () => {
    const printer = await addPrinter(HONEYWELL)
    await app.inject({ method: 'POST', url: `/api/printers/${printer.id}/probe` })

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs',
      payload: { printerId: printer.id, ir: IR, copies: 2 },
    })
    expect(res.statusCode).toBe(202)
  })
})

describe('independent queues', () => {
  it('does not let one printer block the other', async () => {
    // FR-013: queues are per printer, so a paused Honeywell must not hold up
    // the NIIMBOT beside it.
    const h = createHarness()
    const one = h.seedPrinter('niimbot-side')
    const two = h.seedPrinter('zpl-side')

    h.printers.setQueueState(one, 'paused', 'manual')
    const blocked = h.enqueue(one, 1)
    const running = h.enqueue(two, 1)

    await Promise.all([h.queue.drain(one), h.queue.drain(two)])

    expect(h.jobs.find(blocked)?.status).toBe('queued')
    expect(h.jobs.find(running)?.status).toBe('completed')
  })

  it('fails one printer without pausing the other', async () => {
    const h = createHarness((printerId) => ({ unreachable: printerId === 'x-0001' }))
    const failing = h.seedPrinter('failing')
    const healthy = h.seedPrinter('healthy')

    h.enqueue(failing, 1)
    h.enqueue(healthy, 1)

    await Promise.all([h.queue.drain(failing), h.queue.drain(healthy)])

    expect(h.printers.find(failing)?.queueState).toBe('paused')
    expect(h.printers.find(healthy)?.queueState).toBe('running')
  })
})
