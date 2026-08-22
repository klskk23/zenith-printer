import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

/**
 * Serial continuity across print runs, end to end.
 *
 * The unit tests pin the allocator; this pins the whole path a real batch takes
 * — REST in, claim recorded, next batch continuing from it. A duplicate serial
 * introduced anywhere along that path is two boxes nobody can tell apart, and
 * the failure is only visible on physical labels.
 */
let app: FastifyInstance

function seedPrinter(): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'w',
    kind: 'niimbot',
    transport: 'serial',
    address: '/dev/ttyACM0',
    printTaskName: 'B1',
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203,
    printheadPixels: 576,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1],
    printDirection: 'top',
    supportsConsumableLevel: true,
    model: 'B3S_P',
    serial: null,
    firmwareVersion: null,
  })
  return printer.id
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function pool(name = '整机流水', digits = 6, step = 1): Promise<string> {
  return (
    await app.inject({ method: 'POST', url: '/api/sequence-pools', payload: { name, digits, step } })
  ).json().id as string
}

async function design(poolId: string, name = '整机标签'): Promise<string> {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name,
        printerKind: 'niimbot',
        widthMm: 50,
        heightMm: 30,
        dpi: 203,
        elements: [
          {
            id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
            content: '零件 ${sku} · ${serial}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
          },
        ],
        variables: [
          { name: 'sku', kind: 'constant', value: 'ABC-123' },
          { name: 'serial', kind: 'sequence', poolId },
        ],
      },
    })
  ).json().id as string
}

describe('ten consecutive batches', () => {
  it('issues no serial twice and skips none (SC-004)', async () => {
    const printerId = seedPrinter()
    const templateId = await design(await pool())

    const issued: number[] = []
    for (let batch = 0; batch < 10; batch += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/print-jobs',
        payload: { printerId, templateId, copies: 5 },
        headers: { 'idempotency-key': `batch-${batch}` },
      })
      expect(res.statusCode).toBe(202)
      const claim = res.json().seqClaims[0]
      for (let value = claim.start; value <= claim.end; value += claim.step) {
        issued.push(value)
      }
    }

    expect(issued).toHaveLength(50)
    expect(new Set(issued).size, 'a serial was issued twice').toBe(50)
    expect(issued, 'a serial was skipped').toEqual(Array.from({ length: 50 }, (_unused, i) => i + 1))
  })
})

describe('a design that references a name nothing defines', () => {
  it('is refused before anything prints, and the reference is named', async () => {
    const printerId = seedPrinter()
    const templateId = (
      await app.inject({
        method: 'POST',
        url: '/api/templates',
        payload: {
          name: '缺变量',
          printerKind: 'niimbot',
          widthMm: 50,
          heightMm: 30,
          dpi: 203,
          elements: [
            {
              id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
              content: '${没定义}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
            },
          ],
          variables: [],
        },
      })
    ).json().id

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs',
      payload: { printerId, templateId, copies: 1 },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('VARIABLE_NOT_DEFINED')
    expect(res.json().details.reference).toBe('没定义')
    // Nothing was queued: a rejected job must not leave a claim or a row.
    expect((await app.inject({ method: 'GET', url: '/api/print-jobs' })).json().jobs).toHaveLength(0)
  })

  it('does not refuse an escaped dollar, which is ordinary text', async () => {
    // `$${sku}` prints the characters "${sku}". Treating that as an unresolved
    // reference would refuse a perfectly printable label.
    const printerId = seedPrinter()
    const templateId = (
      await app.inject({
        method: 'POST',
        url: '/api/templates',
        payload: {
          name: '字面花括号',
          printerKind: 'niimbot',
          widthMm: 50,
          heightMm: 30,
          dpi: 203,
          elements: [
            {
              id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
              content: '$${sku}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
            },
          ],
          variables: [],
        },
      })
    ).json().id

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs',
      payload: { printerId, templateId, copies: 1 },
    })
    expect(res.statusCode).toBe(202)
  })
})
