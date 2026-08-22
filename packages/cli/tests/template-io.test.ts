/**
 * The command line side of template import and export.
 *
 * Driven against a real server on a real port, because what is worth checking
 * is the contract between them — including the one place they disagree
 * usefully: a clash is a 409 the browser turns into a question, and here it
 * has to become an exit code and a sentence.
 *
 * The exit-code rule under test: warnings do not fail the command. "Imported,
 * but the table is not here" is not a failure, and the codes classify
 * failures. A script that wants otherwise says `--fail-on-warning`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '@zenith/server/src/app.ts'
import { openDatabase } from '@zenith/server/src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '@zenith/server/src/clock.ts'
import { registerTemplateIo } from '../src/commands/template-io.ts'

let app: FastifyInstance
let server: string
let out: string[]
let err: string[]
let dir: string

const TEMPLATE = {
  name: '面单',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [],
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
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  server = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`

  dir = mkdtempSync(join(tmpdir(), 'zenith-cli-'))
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

/** Run one command through commander, exactly as the binary would. */
async function cli(...argv: string[]): Promise<void> {
  const program = new Command()
  program.exitOverride()
  program.option('--json')
  registerTemplateIo(program)
  await program.parseAsync(['node', 'zenith', ...argv])
}

const createTemplate = () =>
  app.inject({ method: 'POST', url: '/api/templates', payload: TEMPLATE })

const stdout = (): string => out.join('')
const stderr = (): string => err.join('')

describe('template-export', () => {
  it('writes the file to stdout so it can be redirected', async () => {
    await createTemplate()
    await cli('template-export', '--server', server)

    const file = JSON.parse(stdout()) as { kind: string; templates: unknown[] }
    expect(file.kind).toBe('zenith.templates')
    expect(file.templates).toHaveLength(1)
    expect(process.exitCode).toBe(0)
  })

  it('reports an unreachable service as its own kind of failure', async () => {
    await cli('template-export', '--server', 'http://127.0.0.1:1')
    expect(process.exitCode).toBe(3)
    expect(stderr()).toContain('Could not reach')
  })
})

describe('template-import', () => {
  async function fileFrom(): Promise<string> {
    await createTemplate()
    await cli('template-export', '--server', server)
    const path = join(dir, 'designs.json')
    writeFileSync(path, stdout())
    out = []
    return path
  }

  it('imports and succeeds', async () => {
    const path = await fileFrom()
    const created = (await app.inject({ method: 'GET', url: '/api/templates' })).json()
    await app.inject({ method: 'DELETE', url: `/api/templates/${created.templates[0].id}` })

    await cli('template-import', '--server', server, '--file', path)
    expect(process.exitCode).toBe(0)
    expect(stdout()).toContain('imported 1 design(s)')
  })

  it('stops on a clash rather than deciding, and says which designs', async () => {
    const path = await fileFrom()
    await cli('template-import', '--server', server, '--file', path)

    expect(process.exitCode).toBe(4)
    expect(stderr()).toContain('已存在')
  })

  it('proceeds once told what to do', async () => {
    const path = await fileFrom()
    await cli('template-import', '--server', server, '--file', path, '--on-conflict', 'overwrite')
    expect(process.exitCode).toBe(0)
  })

  it('succeeds with warnings, because a missing table is not a failure', async () => {
    const path = join(dir, 'foreign.json')
    writeFileSync(
      path,
      JSON.stringify({
        kind: 'zenith.templates',
        formatVersion: 1,
        templates: [{ id: 'foreign-1', ...TEMPLATE, dataSourceId: 'nowhere' }],
        dataSources: { nowhere: { name: '订单表', columns: ['订单号'] } },
      }),
    )

    await cli('template-import', '--server', server, '--file', path)

    expect(process.exitCode).toBe(0)
    // The server's wording, printed as-is.
    expect(stdout()).toContain('订单表')
  })

  it('fails on warnings only when asked', async () => {
    const path = join(dir, 'foreign.json')
    writeFileSync(
      path,
      JSON.stringify({
        kind: 'zenith.templates',
        formatVersion: 1,
        templates: [{ id: 'foreign-2', ...TEMPLATE, dataSourceId: 'nowhere' }],
        dataSources: { nowhere: { name: '订单表', columns: ['订单号'] } },
      }),
    )

    await cli('template-import', '--server', server, '--file', path, '--fail-on-warning')
    expect(process.exitCode).toBe(4)
  })

  it('refuses a file that is not JSON, before troubling the server', async () => {
    const path = join(dir, 'broken.json')
    writeFileSync(path, 'not json at all')

    await cli('template-import', '--server', server, '--file', path)
    expect(process.exitCode).toBe(4)
    expect(stderr()).toContain('could not be read as JSON')
  })

  it('emits machine-readable output under --json', async () => {
    const path = await fileFrom()
    await cli('--json', 'template-import', '--server', server, '--file', path, '--on-conflict', 'copy')
    const parsed = JSON.parse(stdout()) as { imported: unknown[]; warnings: unknown[] }
    expect(parsed.imported).toHaveLength(1)
    expect(Array.isArray(parsed.warnings)).toBe(true)
  })
})
