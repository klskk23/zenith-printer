/**
 * The API describing itself.
 *
 * Every route already declares its shape in zod — that is what validates
 * requests and serialises responses. The description is generated from those
 * same schemas rather than written alongside them, because a hand-kept document
 * is a second source of truth that goes stale the first busy week.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'

let app: FastifyInstance

beforeEach(async () => {
  app = buildApp({ db: openDatabase({ location: ':memory:' }), logLevel: 'error' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const document = async (): Promise<Record<string, never>> =>
  (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json()

describe('the OpenAPI document', () => {
  it('is served', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('leaves no route out', async () => {
    /**
     * The spot-checks below name a handful of paths; this asks the question
     * somebody is actually asking when they wonder whether the document is
     * current. Nothing here is hand-written — it is generated from the same
     * zod schemas that validate requests — but a route registered before the
     * plugin's `onRoute` hook exists, or one the transform choked on, is
     * simply absent. And absent is invisible: the console still loads, the
     * other sixty endpoints still work, and the missing one is found by
     * whoever was trying to call it.
     */

    /**
     * `printRoutes` draws a tree: each line is one *segment*, indented four
     * columns per level, so a full path has to be rebuilt from the stack of
     * segments above it. Reading only the top-level lines would make this test
     * pass while checking almost nothing — the nested routes are most of them.
     */
    const registered = new Set<string>()
    const segments: string[] = []
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const start = line.indexOf('/')
      if (start < 0) {
        continue
      }
      const depth = Math.max(0, Math.round(start / 4) - 1)
      const segment = line.slice(start).split(' ')[0]!.split('|')[0]!
      segments.length = depth
      segments[depth] = segment
      if (/\([A-Z, ]+\)/.test(line)) {
        registered.add(segments.join('').replace(/\/$/, '') || '/')
      }
    }

    /**
     * Compared with the parameter *names* erased.
     *
     * Two routes may sit at the same position under different names —
     * `/api/printers/:id/probe` and `/api/printers/:printerId/profiles` — and
     * Fastify prints the shared segment as `/:id|:printerId`. What matters
     * here is whether the position is described, not what it is called.
     */
    const shape = (path: string): string => path.replace(/[:{]\w+\}?/g, ':x')
    const documented = new Set(Object.keys((await document()).paths ?? {}).map(shape))

    // The document cannot describe itself.
    const exempt = new Set(['/api/openapi.json', '/api/docs'])

    const missing = [...registered].filter(
      (path) => path.startsWith('/api/') && !exempt.has(path) && !documented.has(shape(path)),
    )
    // Guards the parser: an empty set of routes would satisfy the check below
    // perfectly, and a tree format that changed would produce exactly that.
    expect(registered.size).toBeGreaterThan(40)
    expect(missing, 'registered but absent from the document').toEqual([])
  })

  it('lists the routes that do the work', async () => {
    const paths = Object.keys((await document()).paths ?? {})
    // A spread of methods and shapes: if the transform silently dropped
    // anything, these are the ones worth noticing.
    for (const path of ['/api/printers', '/api/templates', '/api/print-jobs', '/api/data-sources']) {
      expect(paths, `${path} missing from the document`).toContain(path)
    }
  })

  it('carries the request shapes, not just the paths', async () => {
    // The point of generating it from zod. A document with paths and no schemas
    // is a table of contents, and the console built on it cannot fill anything
    // in for you.
    const doc = await document() as unknown as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>
    }
    expect(doc.paths['/api/print-jobs']?.post?.requestBody).toBeDefined()
  })

  it('describes the path parameters', async () => {
    const doc = await document() as unknown as {
      paths: Record<string, Record<string, { parameters?: Array<{ name: string }> }>>
    }
    const probe = doc.paths['/api/printers/{id}/probe']?.post
    expect(probe?.parameters?.map((p) => p.name)).toContain('id')
  })

  it('says which service it describes', async () => {
    const info = (await document() as unknown as { info: { title: string; version: string } }).info
    expect(info.title).toContain('Zenith')
    // Read from package.json rather than typed in, so it cannot say 0.1.0
    // forever.
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
