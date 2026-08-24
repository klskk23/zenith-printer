/**
 * Designs saved before thumbnails existed.
 *
 * Without a backfill each of them reports "could not be drawn", which is a
 * different and wrong statement: those designs are fine, they simply predate
 * the column. Doing it once keeps `hasThumbnail` meaning what it says.
 */
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { TemplateRepo } from '../../src/db/repositories/template-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { backfillThumbnails } from '../../src/db/migrations/thumbnail-backfill.ts'

const TEXT = {
  id: 't',
  type: 'text',
  xMm: 2,
  yMm: 2,
  widthMm: 40,
  heightMm: 6,
  rotation: 0,
  content: '出货单',
  fontFamily: 'Noto Sans CJK SC',
  fontSizeMm: 4,
  bold: false,
  align: 'left',
  inverted: false,
}

function seed(elements: unknown[]): { repo: TemplateRepo; id: string; db: ReturnType<typeof openDatabase> } {
  const db = openDatabase({ location: ':memory:' })
  // This runs as migration 11, which is before 15 moved image bytes into the
  // rows — so at that point images are still files and `storage_path` is still
  // there. Put it back, or the test asks the function to run against a schema
  // it never meets.
  db.exec("ALTER TABLE images ADD COLUMN storage_path TEXT NOT NULL DEFAULT ''")
  const repo = new TemplateRepo({
    db,
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    ids: new SequentialIdGenerator('t'),
  })
  const template = repo.create({
    name: 'old design',
    printerKind: 'niimbot',
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: elements as never,
    variables: [],
    dataSourceId: null,
  })
  // Back to how the row looked before this feature existed.
  repo.saveThumbnail(template.id, null)
  return { repo, id: template.id, db }
}

const logs: Array<Record<string, unknown>> = []
const log = (event: Record<string, unknown>): void => {
  logs.push(event)
}

describe('backfilling thumbnails', () => {
  it('draws a picture for a design that had none', () => {
    const { repo, id, db } = seed([TEXT])
    expect(repo.thumbnail(id)).toBeUndefined()

    backfillThumbnails(db, log)

    expect(repo.thumbnail(id)).toBeDefined()
    expect(repo.find(id)!.hasThumbnail).toBe(true)
  })

  it('leaves a design it cannot draw as it is, rather than failing the migration', () => {
    // EAN-13 needs digits. One bad design must not stop the upgrade.
    const bad = {
      id: 'c', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, rotation: 0,
      content: 'not-digits', symbology: 'ean13', showHumanReadable: true, moduleWidthDots: 2,
    }
    const { repo, id, db } = seed([bad])

    expect(() => backfillThumbnails(db, log)).not.toThrow()
    expect(repo.thumbnail(id)).toBeUndefined()
  })

  it('says how many it drew and how many it could not', () => {
    logs.length = 0
    const { db } = seed([TEXT])
    backfillThumbnails(db, log)
    expect(logs.at(-1)).toMatchObject({ event: 'thumbnail_backfill', drawn: 1, failed: 0 })
  })

  it('does nothing, and loads no fonts, when every design already has one', () => {
    // The common case on every boot after the first.
    logs.length = 0
    const { db } = seed([TEXT])
    backfillThumbnails(db, log)
    logs.length = 0
    backfillThumbnails(db, log)
    expect(logs).toEqual([])
  })
})
