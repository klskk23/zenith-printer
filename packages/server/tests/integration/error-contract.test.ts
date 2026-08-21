import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { ApiError, HttpStatus } from '../../src/api/errors.ts'
import { PrinterDeviceError, PrinterUnreachableError } from '../../src/drivers/port.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let app: FastifyInstance

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('job'),
    logLevel: 'error',
  })

  // Routes that raise each failure class, so the contract can be asserted
  // without depending on any particular endpoint.
  app.post('/test/validate', {
    schema: { body: z.object({ copies: z.number().int().positive() }) },
    handler: async () => ({ ok: true }),
  })
  app.get('/test/conflict', async () => {
    throw ApiError.conflict('JOB_ALREADY_PRINTING')
  })
  app.get('/test/unprocessable', async () => {
    throw ApiError.unprocessable('INSUFFICIENT_CONSUMABLE', { remaining: 42, requested: 80 })
  })
  app.get('/test/unreachable', async () => {
    throw new PrinterUnreachableError('/dev/ttyACM0')
  })
  app.get('/test/device', async () => {
    throw new PrinterDeviceError('lack paper', 2)
  })
  app.get('/test/boom', async () => {
    throw new Error('unexpected internal failure with secret detail')
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const FIELDS = ['code', 'what', 'why', 'next'] as const

describe('error shape', () => {
  it.each([
    ['/test/conflict', HttpStatus.Conflict],
    ['/test/unprocessable', HttpStatus.UnprocessableEntity],
    ['/test/unreachable', HttpStatus.ServiceUnavailable],
    ['/test/device', HttpStatus.UnprocessableEntity],
    ['/test/boom', HttpStatus.InternalServerError],
  ])('%s returns all four fields', async (url, status) => {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(status)
    const body = res.json()
    for (const field of FIELDS) {
      expect(typeof body[field]).toBe('string')
      expect(body[field].length).toBeGreaterThan(0)
    }
  })

  it('returns all four fields for a validation failure too', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/validate', payload: { copies: -1 } })
    expect(res.statusCode).toBe(HttpStatus.BadRequest)
    const body = res.json()
    for (const field of FIELDS) {
      expect(typeof body[field]).toBe('string')
    }
  })

  it('returns all four fields for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(HttpStatus.NotFound)
    for (const field of FIELDS) {
      expect(typeof res.json()[field]).toBe('string')
    }
  })
})

describe('status code semantics', () => {
  it('uses 409 for a timing conflict', async () => {
    // Cancelling a job that is already printing might succeed at another time.
    const res = await app.inject({ method: 'GET', url: '/test/conflict' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('JOB_ALREADY_PRINTING')
  })

  it('uses 422 for a content problem', async () => {
    // Asking for more labels than remain will never work unchanged.
    const res = await app.inject({ method: 'GET', url: '/test/unprocessable' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('INSUFFICIENT_CONSUMABLE')
  })

  it('uses 503 only for an unreachable device', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/unreachable' })
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('PRINTER_UNREACHABLE')
  })

  it('is stable: the same failure always yields the same status', async () => {
    const first = await app.inject({ method: 'GET', url: '/test/unprocessable' })
    const second = await app.inject({ method: 'GET', url: '/test/unprocessable' })
    expect(first.statusCode).toBe(second.statusCode)
    expect(first.json().code).toBe(second.json().code)
  })
})

describe('detail carried alongside the prose', () => {
  it('reports both the remaining and the requested count', async () => {
    // FR-015 requires the user to see the two numbers, not just "not enough".
    const body = await app.inject({ method: 'GET', url: '/test/unprocessable' }).then((r) => r.json())
    expect(body.details).toEqual({ remaining: 42, requested: 80 })
  })

  it('names the address that could not be reached', async () => {
    const body = await app.inject({ method: 'GET', url: '/test/unreachable' }).then((r) => r.json())
    expect(body.details).toEqual({ address: '/dev/ttyACM0' })
  })
})

describe('device errors', () => {
  it('translates a device reason id into readable copy', async () => {
    // FR-034: never show the raw number.
    const body = await app.inject({ method: 'GET', url: '/test/device' }).then((r) => r.json())
    expect(body.code).toBe('DEVICE_LACK_PAPER')
    expect(body.what).not.toMatch(/\b2\b/)
  })
})

describe('device errors without a reason id', () => {
  it('does not call a device refusal an internal error', async () => {
    // Saying "internal error" sends the operator to the logs when the fix is
    // at the machine.
    const local = buildApp({ db: openDatabase({ location: ':memory:' }), logLevel: 'error' })
    local.get('/test/device-bare', async () => {
      throw new PrinterDeviceError('device refused')
    })
    await local.ready()

    const res = await local.inject({ method: 'GET', url: '/test/device-bare' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DEVICE_ERROR')
    expect(res.json().code).not.toBe('INTERNAL_ERROR')
    await local.close()
  })
})

describe('internal failures', () => {
  it('does not leak the internal message to the client', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/boom' })
    expect(JSON.stringify(res.json())).not.toContain('secret detail')
    expect(res.json().code).toBe('INTERNAL_ERROR')
  })
})

describe('health', () => {
  it('answers on /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
