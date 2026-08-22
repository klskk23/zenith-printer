import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let app: FastifyInstance

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/csv')

/** A multipart body, built by hand so the test exercises the real parser. */
function multipart(
  file: { name: string; bytes: Buffer },
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----zenithtest'
  const chunks: Buffer[] = []
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        'Content-Type: text/csv\r\n\r\n',
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

function upload(fixture: string, fields: Record<string, string> = {}, url = '/api/data-sources') {
  const { payload, headers } = multipart(
    { name: fixture, bytes: readFileSync(join(fixtures, fixture)) },
    fields,
  )
  return app.inject({ method: 'POST', url, payload, headers })
}

function uploadText(text: string, fields: Record<string, string> = {}, url = '/api/data-sources') {
  const { payload, headers } = multipart({ name: 'inline.csv', bytes: Buffer.from(text) }, fields)
  return app.inject({ method: 'POST', url, payload, headers })
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

describe('uploading a CSV', () => {
  it('creates a data source with the header as its columns', async () => {
    const res = await upload('utf8-leading-zeros.csv', { name: '订单表' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      name: '订单表',
      columns: ['订单号', '收件人', '数量'],
      rowCount: 3,
    })
  })

  it('names it after the file when no name is given', async () => {
    // Saves a decision at the moment of import, and the file name is nearly
    // always what the table should be called (FR-020).
    expect((await upload('utf8-leading-zeros.csv')).json().name).toBe('utf8-leading-zeros')
  })

  it('keeps a leading zero all the way through the API', async () => {
    const id = (await upload('utf8-leading-zeros.csv', { name: '订单表' })).json().id
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows` })).json()
    expect(rows.rows[0].values.数量).toBe('007')
  })

  it('reads a GBK, semicolon-delimited export and says what it used', async () => {
    const res = await upload('gbk-semicolon.csv', { name: '中文表' })
    expect(res.json()).toMatchObject({ encoding: 'gb18030', delimiter: ';' })
    expect(res.json().columns).toEqual(['订单号', '收件人', '数量'])
  })

  it('lets the user name the encoding after a bad guess', async () => {
    const res = await upload('gbk-semicolon.csv', { name: '中文表', encoding: 'gb18030' })
    expect(res.statusCode).toBe(201)
  })

  it('refuses a header with a blank column name', async () => {
    const res = await upload('blank-column-name.csv', { name: '坏表头' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CSV_NO_HEADER')
  })

  it('refuses duplicate column names and says which', async () => {
    const res = await upload('duplicate-columns.csv', { name: '重复列' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CSV_DUPLICATE_COLUMN')
    expect(res.json().details.columns).toEqual(['订单号'])
  })

  it('refuses a duplicate data source name', async () => {
    await upload('utf8-leading-zeros.csv', { name: '订单表' })
    const res = await upload('utf8-leading-zeros.csv', { name: '订单表' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DATA_SOURCE_NAME_TAKEN')
  })

  it('refuses a file with more rows than one source may hold', async () => {
    const many = ['code', ...Array.from({ length: 10_001 }, (_unused, i) => String(i))].join('\n')
    const res = await uploadText(many, { name: '太多行' })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CSV_TOO_MANY_ROWS')
    expect(res.json().details).toMatchObject({ rowCount: 10_001, maxRows: 10_000 })
  })
})

describe('paging rows', () => {
  it('returns ten rows a page by default, with the table total', async () => {
    const csv = ['n', ...Array.from({ length: 25 }, (_unused, i) => String(i + 1))].join('\n')
    const id = (await uploadText(csv, { name: '长表' })).json().id

    const first = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows` })).json()
    expect(first).toMatchObject({ page: 1, pageSize: 10, total: 25 })
    expect(first.rows).toHaveLength(10)
    expect(first.rows[0]).toEqual({ ordinal: 1, values: { n: '1' } })

    const third = (
      await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows?page=3` })
    ).json()
    expect(third.rows).toHaveLength(5)
    expect(third.rows[0].ordinal).toBe(21)
  })
})

describe('renaming', () => {
  it('renames without touching anything else, because designs bind by id', async () => {
    // The name used to be part of the reference syntax, which is why it was
    // immutable. It is not any more, so there is nothing to warn about.
    const id = (await upload('utf8-leading-zeros.csv', { name: '订单表' })).json().id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}`,
      payload: { name: '本周订单' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: '本周订单', rowCount: 3 })
  })

  it('refuses a name another source already has', async () => {
    await upload('utf8-leading-zeros.csv', { name: 'A' })
    const id = (await uploadText('x\n1', { name: 'B' })).json().id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}`,
      payload: { name: 'A' },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('editing rows', () => {
  const seed = async (): Promise<string> =>
    (await uploadText('订单号,收件人\nA-001,张三\nA-002,李四', { name: '订单表' })).json().id

  it('changes a cell', async () => {
    const id = await seed()
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/rows`,
      payload: { upserts: [{ ordinal: 2, values: { 收件人: '王五' } }] },
    })
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows` })).json()
    expect(rows.rows[1].values).toEqual({ 订单号: 'A-002', 收件人: '王五' })
  })

  it('appends a row', async () => {
    const id = await seed()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/rows`,
      payload: { upserts: [{ ordinal: 3, values: { 订单号: 'A-003', 收件人: '赵六' } }] },
    })
    expect(res.json().rowCount).toBe(3)
  })

  it('renumbers after a delete, so a 5-12 range still means what the screen shows', async () => {
    const id = await seed()
    await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/rows`,
      payload: { deletes: [1] },
    })
    const rows = (await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows` })).json()
    expect(rows.rows).toEqual([{ ordinal: 1, values: { 订单号: 'A-002', 收件人: '李四' } }])
  })

  it('refuses a column the table does not have', async () => {
    // Column names are reference names; one that arrived from a paste would
    // have got there without anybody choosing to call it that (FR-049).
    const id = await seed()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/data-sources/${id}/rows`,
      payload: { upserts: [{ ordinal: 1, values: { 凭空多出的列: 'x' } }] },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('DATA_SOURCE_UNKNOWN_COLUMN')
    expect(res.json().details.columns).toEqual(['凭空多出的列'])
  })
})

describe('replacing a table', () => {
  const design = async (dataSourceId: string, content = '${收件人}'): Promise<string> =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/templates',
        payload: {
          name: '面单',
          printerKind: 'niimbot',
          widthMm: 50,
          heightMm: 30,
          dpi: 203,
          elements: [
            {
              id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5,
              content, fontFamily: 'Noto Sans CJK SC', fontSizeMm: 3,
            },
          ],
          variables: [],
          dataSourceId,
        },
      })
    ).json().id

  it('replaces the rows when no referenced column disappears', async () => {
    const id = (await uploadText('订单号,收件人\nA,张三', { name: '订单表' })).json().id
    await design(id)

    const res = await upload(
      'utf8-leading-zeros.csv',
      {},
      `/api/data-sources/${id}/replace`,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().columns).toEqual(['订单号', '收件人', '数量'])
  })

  it('stops when a referenced column would vanish, naming it and the design', async () => {
    const id = (await uploadText('订单号,收件人\nA,张三', { name: '订单表' })).json().id
    await design(id)

    const res = await uploadText('订单号,电话\nA,123', {}, `/api/data-sources/${id}/replace`)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DATA_SOURCE_COLUMNS_REMOVED')
    expect(res.json().details.removedColumns).toEqual(['收件人'])
    expect(res.json().details.affectedTemplates[0]).toMatchObject({ name: '面单' })
  })

  it('goes ahead once confirmed', async () => {
    const id = (await uploadText('订单号,收件人\nA,张三', { name: '订单表' })).json().id
    await design(id)

    const res = await uploadText(
      '订单号,电话\nA,123',
      {},
      `/api/data-sources/${id}/replace?confirm=true`,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().columns).toEqual(['订单号', '电话'])
  })

  it('does not stop for a column nothing references', async () => {
    const id = (await uploadText('订单号,收件人,备注\nA,张三,x', { name: '订单表' })).json().id
    await design(id)

    const res = await uploadText('订单号,收件人\nA,张三', {}, `/api/data-sources/${id}/replace`)
    expect(res.statusCode).toBe(200)
  })
})

describe('deleting a table', () => {
  it('requires confirmation, because the rows cannot be recovered', async () => {
    const id = (await upload('utf8-leading-zeros.csv', { name: '订单表' })).json().id
    const res = await app.inject({ method: 'DELETE', url: `/api/data-sources/${id}` })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CONFIRMATION_REQUIRED')
  })

  it('deletes even while a design is bound to it', async () => {
    // The design is recoverable — rebind it to another table of the same shape
    // and every reference resolves again — so blocking the delete would be
    // stopping a reversible thing for the wrong reason (FR-028).
    const id = (await uploadText('订单号,收件人\nA,张三', { name: '订单表' })).json().id
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '面单',
        printerKind: 'niimbot',
        widthMm: 50,
        heightMm: 30,
        dpi: 203,
        elements: [],
        variables: [],
        dataSourceId: id,
      },
    })

    const res = await app.inject({ method: 'DELETE', url: `/api/data-sources/${id}?confirm=true` })
    expect(res.statusCode).toBe(204)
  })

  it('takes the rows with it', async () => {
    const id = (await upload('utf8-leading-zeros.csv', { name: '订单表' })).json().id
    await app.inject({ method: 'DELETE', url: `/api/data-sources/${id}?confirm=true` })
    expect((await app.inject({ method: 'GET', url: `/api/data-sources/${id}/rows` })).statusCode).toBe(404)
  })

  it('names the designs in the confirmation, as information rather than a gate', async () => {
    const id = (await uploadText('订单号\nA', { name: '订单表' })).json().id
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: '面单',
        printerKind: 'niimbot',
        widthMm: 50, heightMm: 30, dpi: 203,
        elements: [], variables: [], dataSourceId: id,
      },
    })
    const res = await app.inject({ method: 'DELETE', url: `/api/data-sources/${id}` })
    expect(res.json().details.affectedTemplates[0]).toMatchObject({ name: '面单' })
  })
})
