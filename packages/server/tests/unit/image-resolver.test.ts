import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Database } from '../../src/db/index.ts'
import { ImageRepo } from '../../src/db/repositories/image-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { createImageResolver } from '../../src/render/image-resolver.ts'

let db: Database
let repo: ImageRepo
let dir: string

const CONTENT = Buffer.from('fake-png-bytes')

function seed(): { id: string; path: string } {
  const asset = repo.create({
    filename: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: CONTENT.length,
  })
  repo.attachFile(asset.id, `${asset.id}.png`)
  const path = join(dir, `${asset.id}.png`)
  writeFileSync(path, CONTENT)
  return { id: asset.id, path }
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
  dir = mkdtempSync(join(tmpdir(), 'zenith-resolve-'))
  db = openDatabase({ location: ':memory:' })
  repo = new ImageRepo({
    db,
    storageDir: dir,
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    ids: new SequentialIdGenerator('img'),
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('data URIs', () => {
  it('inlines the bytes so resvg can read them', () => {
    // resvg has no HTTP client. A relative href is skipped silently, which
    // means the logo shows in the editor and vanishes from the printed label.
    const { id } = seed()
    const uri = createImageResolver(repo)(id)
    expect(uri).toBe(`data:image/png;base64,${CONTENT.toString('base64')}`)
  })

  it(`uses the asset's recorded mime type`, () => {
    const asset = repo.create({ filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 3 })
    repo.attachFile(asset.id, 'a.jpg')
    writeFileSync(join(dir, 'a.jpg'), CONTENT)
    expect(createImageResolver(repo)(asset.id)).toMatch(/^data:image\/jpeg;base64,/)
  })
})

describe('missing assets', () => {
  it('returns undefined for an unknown id', () => {
    expect(createImageResolver(repo)('nope')).toBeUndefined()
  })

  it('skips the element when the row exists but the file is gone', () => {
    // One missing logo must not block every other label from printing.
    const { id, path } = seed()
    unlinkSync(path)
    expect(createImageResolver(repo)(id)).toBeUndefined()
  })
})

describe('soft-deleted assets', () => {
  it('still resolves, so job history keeps rendering', () => {
    // FR-051: a snapshot cannot duplicate a binary, so the file has to stay
    // reachable after the asset is removed from the picker.
    const { id } = seed()
    referenceFromATemplate(id)
    repo.delete(id)
    expect(createImageResolver(repo)(id)).toMatch(/^data:image\/png;base64,/)
  })
})

describe('caching', () => {
  it('reads each asset once, however many copies are rendered', () => {
    // A hundred-copy job renders a hundred times; re-reading and re-encoding
    // the same logo each time is pure waste.
    const { id, path } = seed()
    const resolve = createImageResolver(repo)
    const first = resolve(id)
    unlinkSync(path)
    expect(resolve(id)).toBe(first)
  })

  it('caches a negative result too', () => {
    const resolve = createImageResolver(repo)
    expect(resolve('nope')).toBeUndefined()
    expect(resolve('nope')).toBeUndefined()
  })
})
