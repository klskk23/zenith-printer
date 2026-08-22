import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'

let app: FastifyInstance
let clock: FixedClock

const ELEMENTS = [
  {
    id: 'code',
    type: 'barcode',
    xMm: 2,
    yMm: 2,
    widthMm: 40,
    heightMm: 12,
    content: '${serial}',
    symbology: 'code128',
  },
  {
    id: 'part',
    type: 'text',
    xMm: 2,
    yMm: 16,
    widthMm: 40,
    heightMm: 5,
    content: '${partNo}',
    fontFamily: 'Noto Sans CJK SC',
    fontSizeMm: 3,
  },
]

const TEMPLATE = {
  name: 'part label',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: ELEMENTS,
  variables: [
    { name: 'partNo', kind: 'constant', value: 'ABC-12345' },
    { name: 'serial', kind: 'sequence', poolId: 'pool-1' },
  ],
  dataSourceId: null,
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
    supportsConsumableLevel: kind === 'niimbot',
    model: kind === 'niimbot' ? 'B3S_P' : 'PC310T',
    serial: null,
    firmwareVersion: null,
  })
  return printer.id
}

beforeEach(async () => {
  clock = new FixedClock('2026-08-21T00:00:00Z')
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock,
    idGenerator: new SequentialIdGenerator('t'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const createTemplate = (body: Record<string, unknown> = TEMPLATE) =>
  app.inject({ method: 'POST', url: '/api/templates', payload: body })

describe('template CRUD', () => {
  it('stores a design with its variables', async () => {
    const res = await createTemplate()
    expect(res.statusCode).toBe(201)
    expect(res.json().variables).toHaveLength(2)
  })

  it('stores the data source binding, so "at most one" is structural', async () => {
    // A column rather than something parsed out of content: a second data
    // source is then not a rule to check but a thing that cannot be written.
    const res = await createTemplate({ ...TEMPLATE, dataSourceId: 'ds-1' })
    expect(res.json().dataSourceId).toBe('ds-1')
  })

  it('defaults to no data source', async () => {
    const { dataSourceId, ...withoutBinding } = TEMPLATE
    expect(dataSourceId).toBeNull()
    expect((await createTemplate(withoutBinding)).json().dataSourceId).toBeNull()
  })

  it('reloads exactly what was saved', async () => {
    const id = (await createTemplate()).json().id
    const loaded = (await app.inject({ method: 'GET', url: `/api/templates/${id}` })).json()
    expect(loaded.elements).toHaveLength(2)
    expect(loaded.widthMm).toBe(50)
  })

  it('rejects duplicate variable names', async () => {
    const res = await createTemplate({
      ...TEMPLATE,
      variables: [
        { name: 'partNo', kind: 'constant', value: 'x' },
        { name: 'partNo', kind: 'constant', value: 'y' },
      ],
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a sequence variable with no pool to draw from', async () => {
    const res = await createTemplate({
      ...TEMPLATE,
      variables: [{ name: 'serial', kind: 'sequence' }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a variable name containing the closing brace', async () => {
    // `}` ends a reference, so a name holding one could never be written.
    const res = await createTemplate({
      ...TEMPLATE,
      variables: [{ name: 'a}b', kind: 'constant', value: 'x' }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a Chinese column-style name with a dot in it', async () => {
    // Names come from spreadsheet headers; the grammar reserves only `}`.
    const res = await createTemplate({
      ...TEMPLATE,
      variables: [{ name: '单价.含税', kind: 'constant', value: '19.90' }],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().variables[0].name).toBe('单价.含税')
  })

  it('deletes without breaking anything downstream', async () => {
    const id = (await createTemplate()).json().id
    expect((await app.inject({ method: 'DELETE', url: `/api/templates/${id}` })).statusCode).toBe(204)
  })
})

describe('canvas width', () => {
  it('refuses a canvas wider than any printer of that kind', async () => {
    // FR-005: the device clips its right edge silently.
    seedPrinter('niimbot')
    const res = await createTemplate({ ...TEMPLATE, widthMm: 90 })
    expect(res.statusCode).toBe(422)
    expect(res.json().details.maxLabelWidthMm).toBeCloseTo(72.071, 2)
  })

  it('allows a wider canvas for a printer kind that can image it', async () => {
    seedPrinter('zpl')
    const res = await createTemplate({ ...TEMPLATE, printerKind: 'zpl', widthMm: 100 })
    expect(res.statusCode).toBe(201)
  })
})

describe('concurrent edits', () => {
  it('accepts a save carrying the current token', async () => {
    const created = (await createTemplate()).json()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'renamed', version: created.version },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('renamed')
  })

  it('bumps the token on every accepted save', async () => {
    const created = (await createTemplate()).json()
    expect(created.version).toBe(1)

    const first = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'first', version: 1 },
    })
    expect(first.json().version).toBe(2)
  })

  it('refuses a save carrying a stale token', async () => {
    // Last write wins is fine; losing work without being told is not.
    const created = (await createTemplate()).json()
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'first', version: created.version },
    })

    const second = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'second', version: created.version },
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().code).toBe('TEMPLATE_VERSION_CONFLICT')
    expect(second.json().details.currentVersion).toBe(2)
  })

  /**
   * The token used to be `updatedAt`. Two saves inside one clock tick carried
   * equal timestamps, so the second compared as current and overwrote the first
   * while reporting success. Nothing advances the clock here on purpose — that
   * is the case the old check could not see, and the old test only passed
   * because it advanced the clock itself.
   */
  it('detects a conflict even when both saves land on the same instant', async () => {
    const created = (await createTemplate()).json()

    const first = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'saved by A', version: created.version },
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'saved by B', version: created.version },
    })

    expect(second.statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/api/templates/${created.id}` })).json().name)
      .toBe('saved by A')
  })

  it('keeps the first save intact after a conflict', async () => {
    const created = (await createTemplate()).json()
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'first', version: created.version },
    })
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'second', version: created.version },
    })

    const current = await app.inject({ method: 'GET', url: `/api/templates/${created.id}` })
    expect(current.json().name).toBe('first')
  })

  it('rejects a save with no token at all', async () => {
    const created = (await createTemplate()).json()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'no token' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('the retired print form endpoint', () => {
  /**
   * Its job was to say which values the operator had to type before printing,
   * and nothing is typed any more. A negative assertion because the endpoint
   * is easy to reintroduce: the shape of the route file still invites it.
   */
  it('is gone', async () => {
    const id = (await createTemplate()).json().id
    const res = await app.inject({ method: 'GET', url: `/api/templates/${id}/print-form` })
    expect(res.statusCode).toBe(404)
  })
})

describe('profiles', () => {
  it('creates a profile bound to a printer', async () => {
    const printerId = seedPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${printerId}/profiles`,
      payload: { name: 'thick stock', density: 4, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ density: 4, labelWidthMm: 50, labelHeightMm: 30, marginTopMm: 0 })
  })

  it('refuses a density the device cannot accept', async () => {
    // The printer would refuse it too, with a far less useful message.
    const printerId = seedPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${printerId}/profiles`,
      payload: { name: 'too dark', density: 9, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().details).toMatchObject({ densityMin: 1, densityMax: 5 })
  })

  it('does not touch any template when a profile changes', async () => {
    // FR-027: switching to thicker stock must not disturb a design that was
    // already correct.
    const printerId = seedPrinter()
    const template = (await createTemplate()).json()
    const profile = (
      await app.inject({
        method: 'POST',
        url: `/api/printers/${printerId}/profiles`,
        payload: { name: 'p', density: 3, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 },
      })
    ).json()

    await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.id}`,
      payload: { name: 'p', density: 5, labelType: 1, labelWidthMm: 50, labelHeightMm: 30 },
    })

    const after = (await app.inject({ method: 'GET', url: `/api/templates/${template.id}` })).json()
    expect(after).toEqual(template)
  })

  it('keeps only one default per printer', async () => {
    const printerId = seedPrinter()
    for (const name of ['a', 'b']) {
      await app.inject({
        method: 'POST',
        url: `/api/printers/${printerId}/profiles`,
        payload: { name, density: 3, labelType: 1, labelWidthMm: 50, labelHeightMm: 30, isDefault: true },
      })
    }
    const list = (await app.inject({ method: 'GET', url: `/api/printers/${printerId}/profiles` })).json()
    expect(list.profiles.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1)
  })
})

describe('renaming a template', () => {
  const rename = (id: string, name: unknown) =>
    app.inject({ method: 'PATCH', url: `/api/templates/${id}`, payload: { name } })

  it('changes the name and nothing else', async () => {
    const created = (await createTemplate()).json()
    const res = await rename(created.id, '零件标签')

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('零件标签')
    expect(res.json().elements).toHaveLength(2)
    expect(res.json().variables).toHaveLength(2)
    expect(res.json().widthMm).toBe(50)
  })

  it('does not need the design sent back with it', async () => {
    // The point of a separate endpoint: renaming from the library must not
    // depend on holding a current copy of the elements.
    const created = (await createTemplate()).json()
    const res = await rename(created.id, 'renamed')
    expect(res.statusCode).toBe(200)
  })

  it('bumps the version, so an open editor is told rather than reverting it', async () => {
    // A design tab still holds the old name. Without the bump its next save
    // would put that name back and nobody would be told the rename was lost.
    const created = (await createTemplate()).json()
    await rename(created.id, 'renamed')

    const stale = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, version: created.version },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('TEMPLATE_VERSION_CONFLICT')
  })

  it('lets the editor save again once it has reloaded', async () => {
    const created = (await createTemplate()).json()
    const renamed = (await rename(created.id, 'renamed')).json()

    const res = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'renamed', version: renamed.version },
    })
    expect(res.statusCode).toBe(200)
  })

  it('trims surrounding space rather than storing it', async () => {
    const created = (await createTemplate()).json()
    expect((await rename(created.id, '  spaced  ')).json().name).toBe('spaced')
  })

  it('refuses an empty name', async () => {
    const created = (await createTemplate()).json()
    expect((await rename(created.id, '   ')).statusCode).toBe(400)
  })

  it('refuses a name longer than the column allows', async () => {
    const created = (await createTemplate()).json()
    expect((await rename(created.id, 'x'.repeat(81))).statusCode).toBe(400)
  })

  it('is a 404 for a template that does not exist', async () => {
    expect((await rename('t-nope', 'whatever')).statusCode).toBe(404)
  })

  it('allows two templates to share a name, since nothing references one by name', async () => {
    await createTemplate()
    const second = (await createTemplate({ ...TEMPLATE, name: 'other' })).json()
    expect((await rename(second.id, 'part label')).statusCode).toBe(200)
  })
})

describe('the library thumbnail', () => {
  const fetchThumb = (id: string) =>
    app.inject({ method: 'GET', url: `/api/templates/${id}/thumbnail` })

  it('is generated when the design is saved', async () => {
    const created = (await createTemplate()).json()
    expect(created.hasThumbnail).toBe(true)

    const res = await fetchThumb(created.id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    // A real PNG, not an empty body: the eight-byte signature.
    expect(res.rawPayload.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })

  it('is not inlined into the list, which returns every design at once', async () => {
    await createTemplate()
    const list = (await app.inject({ method: 'GET', url: '/api/templates' })).json()
    expect(list.templates[0].hasThumbnail).toBe(true)
    expect(list.templates[0].thumbnail).toBeUndefined()
  })

  it('is redrawn when the design is saved again', async () => {
    const created = (await createTemplate()).json()
    const before = (await fetchThumb(created.id)).rawPayload

    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: {
        ...TEMPLATE,
        elements: [{ ...ELEMENTS[1], content: 'a much longer piece of text than before' }],
        version: created.version,
      },
    })

    expect((await fetchThumb(created.id)).rawPayload).not.toEqual(before)
  })

  it('is left alone by a rename, which does not change the picture', async () => {
    const created = (await createTemplate()).json()
    const before = (await fetchThumb(created.id)).rawPayload

    await app.inject({
      method: 'PATCH',
      url: `/api/templates/${created.id}`,
      payload: { name: 'renamed' },
    })

    expect((await fetchThumb(created.id)).rawPayload).toEqual(before)
  })

  it('is cached hard, since a new save is a new version', async () => {
    const created = (await createTemplate()).json()
    const res = await fetchThumb(created.id)
    expect(res.headers['cache-control']).toContain('immutable')
  })

  it('is a 404 for a template that does not exist', async () => {
    expect((await fetchThumb('t-nope')).statusCode).toBe(404)
  })

  it('still saves a design whose picture cannot be drawn', async () => {
    // An EAN-13 needs digits. The design is wrong and the editor says so, but
    // it is still a design somebody is allowed to keep and come back to —
    // losing the save over its thumbnail would be the wrong trade.
    const res = await createTemplate({
      ...TEMPLATE,
      elements: [{ ...ELEMENTS[0], symbology: 'ean13', content: 'not-digits' }],
      variables: [],
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().hasThumbnail).toBe(false)
    expect((await fetchThumb(res.json().id)).statusCode).toBe(404)
  })
})
