/**
 * Refreshing from the command line.
 *
 * Driven against a real server, because what matters is the contract between
 * them — particularly the place they differ on purpose: the browser turns a
 * header change into a dialog, and here it has to become an exit code and a
 * sentence, without deciding anything on the operator's behalf.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '@zenith/server/src/app.ts'
import { openDatabase } from '@zenith/server/src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '@zenith/server/src/clock.ts'
import { fakeSheetsPort, type FakeSheetsScript } from '@zenith/server/src/integrations/fake-sheets-port.ts'
import { registerDataSourceRefresh } from '../src/commands/data-source-refresh.ts'

let app: FastifyInstance
let server: string
let out: string[]
let err: string[]

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

const sheet = (header: string[], rows: string[][]): FakeSheetsScript => ({
  spreadsheets: { [ID]: { title: '出货台账', worksheets: [{ id: 0, title: '本月出货' }] } },
  values: { [`${ID}/本月出货`]: [header, ...rows] },
})

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
    sheets: {
      port: fakeSheetsPort(sheet(['订单号', '收件人'], [['A-001', '张三']])),
      clientEmail: 'r@example.com',
    },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  server = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`

  out = []
  err = []
  process.exitCode = undefined
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk))
    return true
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  await app.close()
})

async function cli(...argv: string[]): Promise<void> {
  const program = new Command()
  program.exitOverride()
  program.option('--json')
  registerDataSourceRefresh(program)
  await program.parseAsync(['node', 'zenith', ...argv])
}

async function linked(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/data-sources/google',
    payload: { spreadsheetId: ID, worksheetId: 0, name: '本月出货' },
  })
  return res.json().id as string
}

function rescript(script: FakeSheetsScript): void {
  ;(app.ctx as { sheets: { port: unknown } }).sheets.port = fakeSheetsPort(script)
}

const stdout = (): string => out.join('')
const stderr = (): string => err.join('')

describe('data-source-refresh', () => {
  it('refreshes and exits zero', async () => {
    const id = await linked()
    rescript(sheet(['订单号', '收件人'], [['A-001', '张三'], ['A-002', '李四']]))

    await cli('data-source-refresh', '--server', server, '--id', id)
    expect(process.exitCode).toBe(0)
    expect(stdout()).toContain('1 rows to 2')
  })

  it('reports an unreachable service as its own kind of failure', async () => {
    await cli('data-source-refresh', '--server', 'http://127.0.0.1:1', '--id', 'x')
    expect(process.exitCode).toBe(3)
    expect(stderr()).toContain('Could not reach')
  })

  it('is a failure when the data source does not exist', async () => {
    await cli('data-source-refresh', '--server', server, '--id', 'nope')
    expect(process.exitCode).toBe(4)
  })

  it('refuses to decide a header change on its own', async () => {
    // Unattended is exactly where a silent breaking change does the most
    // damage, so the command stops and says which designs it would break.
    const id = await linked()
    rescript(sheet(['订单号'], [['A-001']]))

    await cli('data-source-refresh', '--server', server, '--id', id)
    expect(process.exitCode).toBe(4)
    expect(stderr()).toContain('收件人')
    expect(stderr()).toContain('--confirm-column-change')
  })

  it('applies it when told to', async () => {
    const id = await linked()
    rescript(sheet(['订单号'], [['A-001']]))

    await cli('data-source-refresh', '--server', server, '--id', id, '--confirm-column-change')
    expect(process.exitCode).toBe(0)
  })

  it('reports a failed fetch without pretending it worked', async () => {
    const id = await linked()
    rescript({ failWith: 'notShared' })

    await cli('data-source-refresh', '--server', server, '--id', id)
    expect(process.exitCode).toBe(4)
    expect(stderr()).toContain('still be printed')
  })

  it('emits machine-readable output under --json', async () => {
    const id = await linked()
    await cli('--json', 'data-source-refresh', '--server', server, '--id', id)

    const parsed = JSON.parse(stdout()) as { outcome: string }
    expect(parsed.outcome).toBe('applied')
  })
})
