/**
 * Exporting designs to a file and reading them back.
 *
 * The rule under test throughout: a file this build cannot *represent* is
 * refused; a file whose *references* do not resolve is imported and reported
 * on. A design missing its table is still the design somebody meant to send.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'

let app: FastifyInstance

const TEMPLATE = {
  name: '面单',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, content: '${收件人}', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3 },
  ],
  variables: [],
  dataSourceId: null,
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('t'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const create = (body: Record<string, unknown> = TEMPLATE) =>
  app.inject({ method: 'POST', url: '/api/templates', payload: body })

const exportAll = () => app.inject({ method: 'GET', url: '/api/templates/export' })

const importFile = (file: unknown, onConflict?: 'overwrite' | 'copy') =>
  app.inject({
    method: 'POST',
    url: '/api/templates/import',
    payload: onConflict === undefined ? { file } : { file, onConflict },
  })

async function makePool(name = '出货号'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/sequence-pools',
    payload: { name, digits: 6, step: 1 },
  })
  return res.json().id as string
}

/** Straight through the repo: the endpoint takes a CSV upload, not JSON. */
function makeSource(name = '订单表', columns = ['订单号', '收件人']): string {
  const repo = new DataSourceRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  return repo.create({ name, columns, rows: [] }).id
}

describe('exporting', () => {
  it('produces a file that names itself and its version', async () => {
    await create()
    const file = (await exportAll()).json()
    expect(file.kind).toBe('zenith.templates')
    expect(file.formatVersion).toBe(1)
    expect(file.templates).toHaveLength(1)
  })

  it('exports only what was asked for', async () => {
    const first = (await create()).json()
    await create({ ...TEMPLATE, name: '别的' })
    const res = await app.inject({ method: 'GET', url: `/api/templates/export?ids=${first.id}` })
    expect(res.json().templates.map((t: { name: string }) => t.name)).toEqual(['面单'])
  })

  it('carries a sequence pool as a definition and never as a counter', async () => {
    // Two machines both believing they own a range print duplicate serials,
    // and that is only visible with the labels side by side (FR-006).
    const poolId = await makePool()
    await create({ ...TEMPLATE, variables: [{ name: 'serial', kind: 'sequence', poolId }] })

    const pool = (await exportAll()).json().pools[poolId]
    expect(pool).toEqual({ name: '出货号', digits: 6, step: 1, floor: 0 })
    expect(pool).not.toHaveProperty('next')
    expect(pool).not.toHaveProperty('current')
  })

  it('carries a data source as identity and shape, never as rows', async () => {
    const dataSourceId = makeSource()
    await create({ ...TEMPLATE, dataSourceId })

    const source = (await exportAll()).json().dataSources[dataSourceId]
    expect(source).toEqual({ name: '订单表', columns: ['订单号', '收件人'] })
    expect(source).not.toHaveProperty('rows')
  })

  it('is a 404 for a template that does not exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/templates/export?ids=nope' })).statusCode).toBe(404)
  })
})

describe('importing back onto the same machine', () => {
  it('restores the design under its own id', async () => {
    const created = (await create()).json()
    const file = (await exportAll()).json()
    await app.inject({ method: 'DELETE', url: `/api/templates/${created.id}` })

    const res = await importFile(file)
    expect(res.statusCode).toBe(200)
    expect(res.json().imported[0].id).toBe(created.id)
    expect(res.json().warnings).toEqual([])
  })

  it('asks before overwriting rather than deciding', async () => {
    // Overwriting cannot be undone, and somebody double-clicking a month-old
    // backup may not realise they are discarding today's work.
    await create()
    const file = (await exportAll()).json()

    const res = await importFile(file)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('TEMPLATE_ALREADY_EXISTS')
    expect(res.json().details.templates[0].name).toBe('面单')
  })

  it('overwrites when told to', async () => {
    const created = (await create()).json()
    const file = (await exportAll()).json()
    file.templates[0].name = '改过的名字'

    const res = await importFile(file, 'overwrite')
    expect(res.statusCode).toBe(200)
    const after = await app.inject({ method: 'GET', url: `/api/templates/${created.id}` })
    expect(after.json().name).toBe('改过的名字')
  })

  it('keeps both when told to copy', async () => {
    await create()
    const file = (await exportAll()).json()

    await importFile(file, 'copy')
    const list = (await app.inject({ method: 'GET', url: '/api/templates' })).json()
    expect(list.templates).toHaveLength(2)
    expect(new Set(list.templates.map((t: { id: string }) => t.id)).size).toBe(2)
  })

  it('leaves a restored design with a thumbnail, as a save would', async () => {
    const created = (await create()).json()
    const file = (await exportAll()).json()
    await app.inject({ method: 'DELETE', url: `/api/templates/${created.id}` })
    await importFile(file)

    const res = await app.inject({ method: 'GET', url: `/api/templates/${created.id}/thumbnail` })
    expect(res.statusCode).toBe(200)
  })
})

describe('importing onto a machine that has none of the references', () => {
  /** A file as it would arrive from elsewhere: ids that mean nothing here. */
  const foreign = (over: Record<string, unknown> = {}) => ({
    kind: 'zenith.templates',
    formatVersion: 1,
    templates: [
      {
        id: 'foreign-1',
        ...TEMPLATE,
        variables: [{ name: 'serial', kind: 'sequence', poolId: 'foreign-pool' }],
        dataSourceId: 'foreign-source',
        ...over,
      },
    ],
    pools: { 'foreign-pool': { name: '出货号', digits: 6, step: 1, floor: 500 } },
    dataSources: { 'foreign-source': { name: '订单表', columns: ['订单号', '收件人'] } },
    assets: {},
  })

  it('imports rather than refusing, and says what is missing', async () => {
    const res = await importFile(foreign())
    expect(res.statusCode).toBe(200)
    expect(res.json().imported).toHaveLength(1)

    const codes = res.json().warnings.map((w: { code: string }) => w.code)
    expect(codes).toContain('DATA_SOURCE_MISSING')
    expect(codes).toContain('SEQUENCE_POOL_CREATED')
  })

  it('says which table it wanted and what shape, not just that one is missing', async () => {
    const res = await importFile(foreign())
    const warning = res.json().warnings.find((w: { code: string }) => w.code === 'DATA_SOURCE_MISSING')
    expect(warning.detail.sourceName).toBe('订单表')
    expect(warning.detail.columns).toEqual(['订单号', '收件人'])
    // Worded by the server, so the browser and the CLI say the same thing.
    expect(warning.message).toContain('订单表')
  })

  it('creates the pool from its definition, starting where the file says', async () => {
    await importFile(foreign())
    const pools = (await app.inject({ method: 'GET', url: '/api/sequence-pools' })).json()
    expect(pools.pools).toHaveLength(1)
    expect(pools.pools[0]).toMatchObject({ name: '出货号', digits: 6 })
  })

  it('binds to a same-named table and warns that a name is not an identity', async () => {
    const localId = makeSource('订单表', ['订单号', '收件人'])
    const res = await importFile(foreign())

    const imported = (await app.inject({ method: 'GET', url: '/api/templates' })).json()
    expect(imported.templates[0].dataSourceId).toBe(localId)
    expect(res.json().warnings.map((w: { code: string }) => w.code)).toContain(
      'DATA_SOURCE_MATCHED_BY_NAME',
    )
  })

  it('binds to a same-named table that is the wrong shape, and says which columns', async () => {
    makeSource('订单表', ['订单号'])
    const res = await importFile(foreign())
    const warning = res
      .json()
      .warnings.find((w: { code: string }) => w.code === 'DATA_SOURCE_COLUMNS_DIFFER')
    expect(warning.detail.columns).toEqual(['收件人'])
  })

  it('points a serial at a same-named pool only with a warning attached', async () => {
    // The one decision here with a physical consequence: the wrong counter
    // means the wrong numbers on real labels.
    const localPool = await makePool('出货号')
    const res = await importFile(foreign())

    const imported = (await app.inject({ method: 'GET', url: '/api/templates' })).json()
    expect(imported.templates[0].variables[0].poolId).toBe(localPool)
    expect(res.json().warnings.map((w: { code: string }) => w.code)).toContain(
      'SEQUENCE_POOL_MATCHED_BY_NAME',
    )
  })
})

describe('what is refused', () => {
  it('refuses a JSON that is not one of ours', async () => {
    const res = await importFile({ hello: 'world' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('TEMPLATE_FILE_INVALID')
  })

  it('refuses a file from a newer version rather than reading half of it', async () => {
    await create()
    const file = (await exportAll()).json()
    const res = await importFile({ ...file, formatVersion: 99 })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('TEMPLATE_FILE_TOO_NEW')
  })

  it('refuses an element type this build cannot draw', async () => {
    await create()
    const file = (await exportAll()).json()
    file.templates[0].elements = [{ id: 'x', type: 'hologram', xMm: 0, yMm: 0 }]
    expect((await importFile(file)).statusCode).toBe(422)
  })
})
