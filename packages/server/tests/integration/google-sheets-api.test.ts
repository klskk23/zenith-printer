/**
 * Linking a Google spreadsheet: status, worksheets, preview, create.
 *
 * Every test injects the fake port. The constitution forbids a test that
 * depends on the network, and the two facts that genuinely need a live call are
 * checked by hand instead (`quickstart.md`, HW-1 and HW-2).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '../../src/integrations/fake-sheets-port.ts'
import type { SheetsErrorKind } from '../../src/domain/google-sheets.ts'

let app: FastifyInstance

const ROBOT = 'zenith@example.iam.gserviceaccount.com'
const URL_1 = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0'

const SHEET = {
  title: '出货台账',
  worksheets: [
    { id: 0, title: '本月出货' },
    { id: 77, title: '存档' },
  ],
}

const VALUES = [
  ['订单号', '收件人'],
  ['A-001', '张三'],
  ['A-002', '李四'],
  ['007', '王五'],
]

/** Start a server with the fake wired in, or with no Google at all. */
async function start(script: FakeSheetsScript | null): Promise<void> {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    ...(script === null ? {} : { sheets: { port: fakeSheetsPort(script), clientEmail: ROBOT } }),
  })
  await app.ready()
}

const configured = (over: Partial<FakeSheetsScript> = {}): FakeSheetsScript => ({
  spreadsheets: { '1AbCdEfGhIjKlMnOpQrStUvWxYz012345': SHEET },
  values: { '1AbCdEfGhIjKlMnOpQrStUvWxYz012345/本月出货': VALUES },
  ...over,
})

const worksheets = (url = URL_1) =>
  app.inject({ method: 'POST', url: '/api/google/worksheets', payload: { url } })

const preview = (worksheetId = 0) =>
  app.inject({
    method: 'POST',
    url: '/api/google/preview',
    payload: { spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', worksheetId },
  })

const createLinked = (name: string, worksheetId = 0) =>
  app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', worksheetId, name },
  })

afterEach(async () => {
  await app.close()
})

describe('whether Google is configured at all', () => {
  it('says no when no credentials were provided', async () => {
    await start(null)
    const res = await app.inject({ method: 'GET', url: '/api/google/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ configured: false, clientEmail: null })
  })

  it('names the robot to share with when it is configured', async () => {
    await start(configured())
    expect((await app.inject({ method: 'GET', url: '/api/google/status' })).json()).toEqual({
      configured: true,
      clientEmail: ROBOT,
    })
  })

  it('returns nothing but those two fields', async () => {
    // No project id, no key fingerprint, no file path. On a service with no
    // authentication, everything returned here is returned to everybody.
    await start(configured())
    const body = (await app.inject({ method: 'GET', url: '/api/google/status' })).json()
    expect(Object.keys(body).sort()).toEqual(['clientEmail', 'configured'])
  })
})

describe('listing the worksheets in a spreadsheet', () => {
  it('lists them for a pasted link', async () => {
    await start(configured())
    const res = await worksheets()
    expect(res.statusCode).toBe(200)
    expect(res.json().spreadsheetTitle).toBe('出货台账')
    expect(res.json().worksheets).toEqual(SHEET.worksheets)
  })

  it('refuses a link that is not a spreadsheet', async () => {
    await start(configured())
    const res = await worksheets('https://example.com/nope')
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('GOOGLE_URL_INVALID')
  })

  it('says the feature is not configured rather than failing obscurely', async () => {
    await start(null)
    const res = await worksheets()
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('GOOGLE_NOT_CONFIGURED')
  })

  const failures: Array<[SheetsErrorKind, number, string]> = [
    ['notShared', 422, 'GOOGLE_NOT_SHARED'],
    ['notFound', 404, 'GOOGLE_SPREADSHEET_NOT_FOUND'],
    ['credentialsInvalid', 422, 'GOOGLE_CREDENTIALS_INVALID'],
    ['rateLimited', 429, 'GOOGLE_RATE_LIMITED'],
    ['unreachable', 504, 'GOOGLE_UNREACHABLE'],
    ['timeout', 504, 'GOOGLE_UNREACHABLE'],
  ]

  for (const [kind, status, code] of failures) {
    it(`turns ${kind} into ${status} ${code}`, async () => {
      await start(configured({ failWith: kind }))
      const res = await worksheets()
      expect(res.statusCode).toBe(status)
      expect(res.json().code).toBe(code)
    })
  }

  it('tells the operator which address to share with', async () => {
    // The most common first failure of the whole feature. "Permission denied"
    // sends somebody to check the spreadsheet; the robot's address sends them
    // to fix it.
    await start(configured({ failWith: 'notShared' }))
    const body = (await worksheets()).json()
    expect(JSON.stringify(body)).toContain(ROBOT)
  })
})

describe('previewing a worksheet before creating anything', () => {
  it('returns the columns and some rows', async () => {
    await start(configured())
    const res = await preview()
    expect(res.statusCode).toBe(200)
    expect(res.json().columns).toEqual(['订单号', '收件人'])
    expect(res.json().sampleRows.length).toBeGreaterThanOrEqual(3)
    expect(res.json().totalRows).toBe(3)
  })

  it('keeps a leading zero, which is the whole reason for FORMATTED_VALUE', async () => {
    await start(configured())
    expect((await preview()).json().sampleRows[2].订单号).toBe('007')
  })

  it('suggests the worksheet name and says whether it is taken', async () => {
    await start(configured())
    const res = await preview()
    expect(res.json().suggestedName).toBe('本月出货')
    expect(res.json().nameTaken).toBe(false)
  })

  it('warns before the fact when that name is already used', async () => {
    await start(configured())
    await createLinked('本月出货')
    expect((await preview()).json().nameTaken).toBe(true)
  })

  it('creates nothing at all', async () => {
    await start(configured())
    await preview()
    const list = (await app.inject({ method: 'GET', url: '/api/data-sources' })).json()
    expect(list.dataSources).toEqual([])
  })

  it('refuses a worksheet with nothing in it', async () => {
    await start(configured({ values: { '1AbCdEfGhIjKlMnOpQrStUvWxYz012345/本月出货': [] } }))
    const res = await preview()
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('GOOGLE_WORKSHEET_EMPTY')
  })

  it('refuses a duplicate column name with the code the CSV importer uses', async () => {
    await start(
      configured({
        values: { '1AbCdEfGhIjKlMnOpQrStUvWxYz012345/本月出货': [['a', 'a'], ['1', '2']] },
      }),
    )
    expect((await preview()).json().code).toBe('CSV_DUPLICATE_COLUMN')
  })

  it('refuses more rows than a data source may hold', async () => {
    const big = [['a'], ...Array.from({ length: 10_001 }, (_, i) => [String(i)])]
    await start(configured({ values: { '1AbCdEfGhIjKlMnOpQrStUvWxYz012345/本月出货': big } }))
    const res = await preview()
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CSV_TOO_MANY_ROWS')
  })

  it('is a 422 for a worksheet that is not in the spreadsheet', async () => {
    await start(configured())
    const res = await preview(999)
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('GOOGLE_WORKSHEET_NOT_FOUND')
  })
})

describe('creating the data source', () => {
  it('records where it came from', async () => {
    await start(configured())
    const res = await createLinked('本月出货')

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      name: '本月出货',
      columns: ['订单号', '收件人'],
      rowCount: 3,
      sourceKind: 'google-sheets',
      spreadsheetTitle: '出货台账',
      worksheetTitle: '本月出货',
    })
    expect(res.json().lastRefreshedAt).toBe('2026-08-22T00:00:00.000Z')
  })

  it('stores exactly what the preview showed', async () => {
    // Preview and create go down the same path. If they could differ, the
    // confirmation step would be confirming something else.
    await start(configured())
    const shown = (await preview()).json().sampleRows
    const created = (await createLinked('本月出货')).json()

    const rows = (
      await app.inject({ method: 'GET', url: `/api/data-sources/${created.id}/rows?page=1&pageSize=10` })
    ).json()
    expect(rows.rows.map((r: { values: unknown }) => r.values)).toEqual(shown)
  })

  it('refuses a name that is already taken', async () => {
    await start(configured())
    await createLinked('本月出货')
    const res = await createLinked('本月出货', 77)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DATA_SOURCE_NAME_TAKEN')
  })

  it('allows the same worksheet twice under different names', async () => {
    await start(configured())
    expect((await createLinked('第一份')).statusCode).toBe(201)
    expect((await createLinked('第二份')).statusCode).toBe(201)
  })

  it('leaves a local data source looking exactly as it did', async () => {
    await start(configured())
    await createLinked('本月出货')
    const list = (await app.inject({ method: 'GET', url: '/api/data-sources' })).json()
    expect(list.dataSources[0].sourceKind).toBe('google-sheets')
  })
})
