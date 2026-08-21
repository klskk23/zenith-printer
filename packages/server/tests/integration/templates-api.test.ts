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
    content: { $var: 'serial' },
    symbology: 'code128',
  },
  {
    id: 'part',
    type: 'text',
    xMm: 2,
    yMm: 16,
    widthMm: 40,
    heightMm: 5,
    content: { $var: 'partNo' },
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
  it('stores a template with its variable fields', async () => {
    const res = await createTemplate()
    expect(res.statusCode).toBe(201)
    expect(res.json().variableFields).toHaveLength(2)
  })

  it('reloads exactly what was saved', async () => {
    const id = (await createTemplate()).json().id
    const loaded = (await app.inject({ method: 'GET', url: `/api/templates/${id}` })).json()
    expect(loaded.elements).toHaveLength(2)
    expect(loaded.widthMm).toBe(50)
  })

  it('rejects duplicate field names', async () => {
    const res = await createTemplate({
      ...TEMPLATE,
      variableFields: [
        { name: 'partNo', label: 'A', source: 'manual', sampleValue: 'x' },
        { name: 'partNo', label: 'B', source: 'manual', sampleValue: 'y' },
      ],
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires a sample value for a manual field', async () => {
    // FR-039: without it the editor cannot show what the layout will look like.
    const res = await createTemplate({
      ...TEMPLATE,
      variableFields: [{ name: 'partNo', label: 'Part', source: 'manual' }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires the sequence settings for a sequence field', async () => {
    const res = await createTemplate({
      ...TEMPLATE,
      variableFields: [{ name: 'serial', label: 'Serial', source: 'sequence' }],
    })
    expect(res.statusCode).toBe(400)
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
      payload: { ...TEMPLATE, name: 'renamed', updatedAt: created.updatedAt },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('renamed')
  })

  it('refuses a save carrying a stale token', async () => {
    // Last write wins is fine; losing work without being told is not.
    const created = (await createTemplate()).json()
    clock.advance(1000)
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'first', updatedAt: created.updatedAt },
    })

    const second = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'second', updatedAt: created.updatedAt },
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().details.currentUpdatedAt).not.toBe(created.updatedAt)
  })

  it('keeps the first save intact after a conflict', async () => {
    const created = (await createTemplate()).json()
    clock.advance(1000)
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'first', updatedAt: created.updatedAt },
    })
    await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      payload: { ...TEMPLATE, name: 'second', updatedAt: created.updatedAt },
    })

    const current = (await app.inject({ method: 'GET', url: `/api/templates/${created.id}` })).json()
    expect(current.name).toBe('first')
  })
})

describe('print form', () => {
  it('lists what the client must collect', async () => {
    const id = (await createTemplate()).json().id
    const form = (await app.inject({ method: 'GET', url: `/api/templates/${id}/print-form` })).json()

    expect(form.fields).toHaveLength(2)
    expect(form.fields.find((f: { name: string }) => f.name === 'partNo')).toMatchObject({
      source: 'manual',
      sampleValue: 'ABC-12345',
    })
  })

  it('suggests where the sequence should resume', async () => {
    // FR-048: nobody should have to remember what they printed last week.
    const id = (await createTemplate()).json().id
    const form = (await app.inject({ method: 'GET', url: `/api/templates/${id}/print-form` })).json()

    expect(form.fields.find((f: { name: string }) => f.name === 'serial')).toMatchObject({
      source: 'sequence',
      suggestedStart: 1,
      seqDigits: 3,
      maxRepresentable: 999,
    })
  })
})

describe('profiles', () => {
  it('creates a profile bound to a printer', async () => {
    const printerId = seedPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${printerId}/profiles`,
      payload: { name: 'thick stock', density: 4, labelType: 1, offsetXMm: 0.375, offsetYMm: 0 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ density: 4, offsetXMm: 0.375 })
  })

  it('refuses a density the device cannot accept', async () => {
    // The printer would refuse it too, with a far less useful message.
    const printerId = seedPrinter()
    const res = await app.inject({
      method: 'POST',
      url: `/api/printers/${printerId}/profiles`,
      payload: { name: 'too dark', density: 9, labelType: 1 },
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
        payload: { name: 'p', density: 3, labelType: 1 },
      })
    ).json()

    await app.inject({
      method: 'PATCH',
      url: `/api/profiles/${profile.id}`,
      payload: { name: 'p', density: 5, labelType: 1, offsetXMm: 1, offsetYMm: 1 },
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
        payload: { name, density: 3, labelType: 1, isDefault: true },
      })
    }
    const list = (await app.inject({ method: 'GET', url: `/api/printers/${printerId}/profiles` })).json()
    expect(list.profiles.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1)
  })
})
