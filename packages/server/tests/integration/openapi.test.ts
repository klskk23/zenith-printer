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
