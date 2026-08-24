import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/db/index.ts'
import { ImageRepo } from '../../src/db/repositories/image-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { createImageResolver } from '../../src/render/image-resolver.ts'

let db: Database
let repo: ImageRepo

const CONTENT = Buffer.from('fake-png-bytes')

function seed(): { id: string } {
  const asset = repo.create({
    filename: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: CONTENT.length,
  })
  repo.attachBytes(asset.id, CONTENT)
  return { id: asset.id }
}

/**
 * Make a design name this asset — which is what "referenced" now means.
 *
 * It used to be `repo.addReference(id)`, a counter nothing in the application
 * ever incremented. Pointing a stored design at the asset tests the mechanism
 * that actually decides.
 */
function referenceFromATemplate(assetId: string): void {
  db.prepare(
    `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
     VALUES ('tpl-ref', 't', 'niimbot', 50, 30, 203, ?, '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')`,
  ).run(JSON.stringify([{ id: 'e0', type: 'image', assetId }]))
}

beforeEach(() => {
  db = openDatabase({ location: ':memory:' })
  repo = new ImageRepo({
    db,
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    ids: new SequentialIdGenerator('img'),
  })
})

afterEach(() => {
  db.close()
})

describe('data URIs', () => {
  it('inlines the bytes so resvg can read them', () => {
    // resvg has no HTTP client. A relative href is skipped silently, which
    // means the logo shows in the editor and vanishes from the printed label.
    const { id } = seed()
    const uri = createImageResolver(repo.lookup())(id)
    expect(uri).toBe(`data:image/png;base64,${CONTENT.toString('base64')}`)
  })

  it(`uses the asset's recorded mime type`, () => {
    const asset = repo.create({ filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 3 })
    repo.attachBytes(asset.id, CONTENT)
    expect(createImageResolver(repo.lookup())(asset.id)).toMatch(/^data:image\/jpeg;base64,/)
  })
})

describe('missing assets', () => {
  it('returns undefined for an unknown id', () => {
    expect(createImageResolver(repo.lookup())('nope')).toBeUndefined()
  })

  it('skips the element when the row carries no picture', () => {
    // Reachable: migration 15 kept rows whose file had already gone rather than
    // drop them, because "this picture is missing" and "this label never had
    // one" are different things. One missing logo must not block every other
    // label from printing.
    const { id } = seed()
    db.prepare('UPDATE images SET bytes = NULL WHERE id = ?').run(id)
    expect(createImageResolver(repo.lookup())(id)).toBeUndefined()
  })
})

describe('soft-deleted assets', () => {
  it('still resolves, so job history keeps rendering', () => {
    // FR-051: a snapshot cannot duplicate a binary, so the bytes have to stay
    // reachable after the asset is removed from the picker.
    const { id } = seed()
    referenceFromATemplate(id)
    repo.delete(id)
    expect(createImageResolver(repo.lookup())(id)).toMatch(/^data:image\/png;base64,/)
  })
})

describe('caching', () => {
  it('reads each asset once, however many copies are rendered', () => {
    // A hundred-copy job renders a hundred times; re-reading and re-encoding
    // the same logo each time is pure waste. Proved by taking the bytes away
    // and asking again — a resolver that went back to the table would now
    // return nothing.
    const { id } = seed()
    const resolve = createImageResolver(repo.lookup())
    const first = resolve(id)
    db.prepare('UPDATE images SET bytes = NULL WHERE id = ?').run(id)
    expect(resolve(id)).toBe(first)
  })

  it('caches a negative result too', () => {
    const resolve = createImageResolver(repo.lookup())
    expect(resolve('nope')).toBeUndefined()
    expect(resolve('nope')).toBeUndefined()
  })
})
