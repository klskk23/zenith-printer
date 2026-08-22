import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let app: FastifyInstance

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

const create = (payload: Record<string, unknown> = { name: '整机流水', digits: 6, step: 1 }) =>
  app.inject({ method: 'POST', url: '/api/sequence-pools', payload })

describe('pool CRUD', () => {
  it('creates a pool and reports where its numbering stands', async () => {
    const res = await create()
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: '整机流水', digits: 6, step: 1, floor: 0, current: 0, nextValue: 1 })
  })

  it('returns the floor, so a reset dialog can say "from 741 to what"', async () => {
    await create()
    const list = (await app.inject({ method: 'GET', url: '/api/sequence-pools' })).json()
    expect(list.pools[0]).toHaveProperty('floor')
  })

  it('refuses a duplicate name, since the name is how a pool is picked', async () => {
    await create()
    const res = await create()
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DATA_SOURCE_NAME_TAKEN')
  })

  it('renames and reconfigures through PATCH', async () => {
    const id = (await create()).json().id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sequence-pools/${id}`,
      payload: { name: '改过了', digits: 4, step: 2 },
    })
    expect(res.json()).toMatchObject({ name: '改过了', digits: 4, step: 2 })
  })

  it('refuses a PATCH that would collide with another pool name', async () => {
    await create({ name: 'A', digits: 4, step: 1 })
    const id = (await create({ name: 'B', digits: 4, step: 1 })).json().id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sequence-pools/${id}`,
      payload: { name: 'A', digits: 4, step: 1 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('cannot set the current value through PATCH', async () => {
    // `current` is derived from what was printed. Accepting it here would put a
    // second, editable copy of the number next to the evidence.
    const id = (await create()).json().id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sequence-pools/${id}`,
      payload: { name: '整机流水', digits: 6, step: 1, current: 500 },
    })
    expect(res.json().current).toBe(0)
  })

  it('404s for a pool that does not exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sequence-pools' })).statusCode).toBe(200)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sequence-pools/nope',
      payload: { name: 'x', digits: 4, step: 1 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('reset', () => {
  it('refuses without confirmation', async () => {
    // Restarting at a number already printed produces duplicate serials, and
    // two boxes carrying the same serial cannot be told apart. That must not be
    // reachable by an idempotent retry.
    const id = (await create()).json().id
    const res = await app.inject({
      method: 'POST',
      url: `/api/sequence-pools/${id}/reset`,
      payload: { floor: 1 },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('SEQUENCE_RESET_NOT_CONFIRMED')
  })

  it('moves numbering when confirmed, and says where it landed', async () => {
    const id = (await create()).json().id
    const res = await app.inject({
      method: 'POST',
      url: `/api/sequence-pools/${id}/reset`,
      payload: { floor: 1000, confirm: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ floor: 1000, current: 1000, nextValue: 1000 })
  })

  it('carries the three-part message the constitution requires', async () => {
    const id = (await create()).json().id
    const body = (
      await app.inject({ method: 'POST', url: `/api/sequence-pools/${id}/reset`, payload: { floor: 1 } })
    ).json()
    expect(body.what).toBeTruthy()
    expect(body.why).toBeTruthy()
    expect(body.next).toBeTruthy()
  })
})

describe('deletion', () => {
  it('deletes a pool nothing references', async () => {
    const id = (await create()).json().id
    expect((await app.inject({ method: 'DELETE', url: `/api/sequence-pools/${id}` })).statusCode).toBe(204)
  })

  it('refuses while a design still draws from it, and names the design', async () => {
    // Unlike a data source there is no equivalent pool to re-point at, so the
    // design would simply stop resolving its serial.
    const id = (await create()).json().id
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '整机标签',
        printerKind: 'niimbot',
        widthMm: 50,
        heightMm: 30,
        dpi: 203,
        elements: [],
        variables: [{ name: 'serial', kind: 'sequence', poolId: id }],
      },
    })

    const res = await app.inject({ method: 'DELETE', url: `/api/sequence-pools/${id}` })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('SEQUENCE_POOL_IN_USE')
    expect(res.json().details.affectedTemplates[0]).toMatchObject({ name: '整机标签' })
  })
})
