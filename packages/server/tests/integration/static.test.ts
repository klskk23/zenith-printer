import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { registerStatic } from '../../src/static.ts'

const SHELL = '<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>'

let app: FastifyInstance
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zenith-web-'))
  writeFileSync(join(root, 'index.html'), SHELL)
  app = buildApp({ db: openDatabase({ location: ':memory:' }), logLevel: 'error' })
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('with a frontend build present', () => {
  beforeEach(async () => {
    await registerStatic(app, { root })
    await app.ready()
  })

  it('serves the shell at the root', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
  })

  it('falls back to the shell for a client-side route', async () => {
    // A hard refresh on /editor/new must not 404.
    const res = await app.inject({ method: 'GET', url: '/editor/new' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('id="root"')
  })

  it('keeps API misses as JSON rather than serving HTML', async () => {
    // Returning the SPA shell to a fetch() call would produce a confusing
    // "unexpected token <" instead of a readable error.
    const res = await app.inject({ method: 'GET', url: '/api/missing' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('NOT_FOUND')
  })

  it('still answers the health endpoint', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })
})

describe('without a frontend build', () => {
  beforeEach(async () => {
    await registerStatic(app, { root: join(root, 'does-not-exist') })
    await app.ready()
  })

  it('serves the API anyway rather than refusing to boot', async () => {
    // A missing build is a deployment step not yet run, not a fatal condition.
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })

  it('returns a JSON 404 for a client route when there is no shell to serve', async () => {
    const res = await app.inject({ method: 'GET', url: '/editor/new' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('NOT_FOUND')
  })
})

describe('which build is being served', () => {
  beforeEach(async () => {
    await registerStatic(app, { root })
    await app.ready()
  })

  /**
   * The process hands out whatever `dist` is on disk. A fix that has not been
   * rebuilt is invisible: the source is right, the page is wrong, and nothing
   * says so. This endpoint is how "am I looking at my change?" gets answered
   * without reading the logs.
   */
  it('reports when the frontend was built', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/frontend-build' })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().builtAt).toBe('string')
    expect(Number.isFinite(res.json().ageMinutes)).toBe(true)
  })
})
