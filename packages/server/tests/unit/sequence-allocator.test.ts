import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/db/index.ts'
import { SequenceAllocator, SequenceOverflowError } from '../../src/domain/sequence-allocator.ts'
import { overlaps, rangeFor, valueAt, type VariableField } from '../../src/domain/variable-field.ts'

let db: Database
let allocator: SequenceAllocator

const serial: VariableField = {
  name: 'serial',
  label: 'Serial',
  source: 'sequence',
  seqStart: 1,
  seqDigits: 3,
  seqStep: 1,
}

function seedTemplate(id = 't1'): string {
  db.prepare(
    `INSERT INTO templates (id, name, printer_kind, width_mm, height_mm, dpi, elements, created_at, updated_at)
     VALUES (?, 'label', 'niimbot', 50, 30, 203, '[]', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')`,
  ).run(id)
  return id
}

function seedJob(id: string, templateId: string, status = 'queued'): string {
  db.prepare(
    `INSERT INTO print_jobs (id, idempotency_key, template_id, requested_copies, status, snapshot, created_at)
     VALUES (?, ?, ?, 1, ?, '{}', '2026-08-21T00:00:00Z')`,
  ).run(id, `key-${id}`, templateId, status)
  return id
}

beforeEach(() => {
  db = openDatabase({ location: ':memory:' })
  allocator = new SequenceAllocator(db)
})

describe('suggestion', () => {
  it('starts from the configured value when nothing has been printed', () => {
    const templateId = seedTemplate()
    expect(allocator.suggest(templateId, serial).suggestedStart).toBe(1)
  })

  it('continues from the highest number already issued', () => {
    // FR-048: the user should not have to remember where they left off.
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId, 'completed')
    allocator.allocate({ jobId, templateId, fields: [serial], copies: 37 })

    expect(allocator.suggest(templateId, serial).suggestedStart).toBe(38)
  })

  it('counts numbers from failed jobs too', () => {
    // A failed job still put labels on the table before it stopped, so its
    // numbers are spent. Reusing them would be the harmful direction.
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId, 'failed')
    allocator.allocate({ jobId, templateId, fields: [serial], copies: 10 })

    expect(allocator.suggest(templateId, serial).suggestedStart).toBe(11)
  })

  it('reports the limits alongside the suggestion', () => {
    const templateId = seedTemplate()
    expect(allocator.suggest(templateId, serial)).toMatchObject({
      seqDigits: 3,
      seqStep: 1,
      maxRepresentable: 999,
    })
  })
})

describe('allocation', () => {
  it('claims a contiguous span for the whole batch', () => {
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId)
    const ranges = allocator.allocate({ jobId, templateId, fields: [serial], copies: 80 })

    expect(ranges.serial).toEqual({ start: 1, end: 80, step: 1, digits: 3 })
  })

  it('persists the claim at enqueue time, not at print time', () => {
    // FR-049: two jobs submitted a second apart would otherwise both read the
    // same high-water mark and both start from it.
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId)
    allocator.allocate({ jobId, templateId, fields: [serial], copies: 5 })

    const stored = db.prepare('SELECT seq_ranges FROM print_jobs WHERE id = ?').get(jobId)
    expect(JSON.parse(String(stored?.seq_ranges)).serial).toEqual({ start: 1, end: 5, step: 1, digits: 3 })
  })

  it('gives consecutive jobs non-overlapping spans', () => {
    const templateId = seedTemplate()
    const first = allocator.allocate({
      jobId: seedJob('j1', templateId),
      templateId,
      fields: [serial],
      copies: 10,
    })
    const second = allocator.allocate({
      jobId: seedJob('j2', templateId),
      templateId,
      fields: [serial],
      copies: 10,
    })

    expect(first.serial).toBeDefined()
    expect(second.serial).toBeDefined()
    expect(overlaps(first.serial!, second.serial!)).toBe(false)
    expect(second.serial!.start).toBe(11)
  })

  it('honours a step larger than one', () => {
    const templateId = seedTemplate()
    const stepped = { ...serial, seqStep: 5 }
    const ranges = allocator.allocate({
      jobId: seedJob('j1', templateId),
      templateId,
      fields: [stepped],
      copies: 4,
    })
    expect(ranges.serial).toEqual({ start: 1, end: 16, step: 5, digits: 3 })
  })

  it('returns nothing when the template has no sequence field', () => {
    const templateId = seedTemplate()
    const manual: VariableField = { name: 'partNo', label: 'Part', source: 'manual', sampleValue: 'ABC' }
    expect(allocator.allocate({ jobId: seedJob('j1', templateId), templateId, fields: [manual], copies: 5 })).toEqual({})
  })
})

describe('user overrides', () => {
  it('starts from the value the user chose', () => {
    // Reprinting a spoiled batch with its original numbers is legitimate.
    const templateId = seedTemplate()
    const ranges = allocator.allocate({
      jobId: seedJob('j1', templateId),
      templateId,
      fields: [serial],
      copies: 5,
      overrides: { serial: 500 },
    })
    expect(ranges.serial).toEqual({ start: 500, end: 504, step: 1, digits: 3 })
  })

  it('warns when an override would reissue used numbers, without refusing', () => {
    const templateId = seedTemplate()
    allocator.allocate({ jobId: seedJob('j1', templateId), templateId, fields: [serial], copies: 50 })

    expect(allocator.conflictsWithHistory(templateId, serial, 20)).toBe(true)
    expect(allocator.conflictsWithHistory(templateId, serial, 51)).toBe(false)
  })
})

describe('overflow', () => {
  it('refuses rather than wrapping past the configured width', () => {
    // Wrapping 999 back to 000 silently reissues serials that already exist on
    // physical labels — the one outcome this feature exists to prevent.
    const templateId = seedTemplate()
    expect(() =>
      allocator.allocate({
        jobId: seedJob('j1', templateId),
        templateId,
        fields: [serial],
        copies: 5,
        overrides: { serial: 998 },
      }),
    ).toThrow(SequenceOverflowError)
  })

  it('claims nothing at all when one field overflows', () => {
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId)
    const other: VariableField = { ...serial, name: 'batch' }

    expect(() =>
      allocator.allocate({
        jobId,
        templateId,
        fields: [other, serial],
        copies: 5,
        overrides: { serial: 998 },
      }),
    ).toThrow(SequenceOverflowError)

    // Rolled back: no partial claim survives.
    const stored = db.prepare('SELECT seq_ranges FROM print_jobs WHERE id = ?').get(jobId)
    expect(JSON.parse(String(stored?.seq_ranges))).toEqual({})
  })

  it('reports the offending value and the ceiling', () => {
    const templateId = seedTemplate()
    try {
      allocator.allocate({
        jobId: seedJob('j1', templateId),
        templateId,
        fields: [serial],
        copies: 5,
        overrides: { serial: 998 },
      })
      expect.unreachable('should have thrown')
    } catch (err) {
      const overflow = err as SequenceOverflowError
      expect(overflow.fieldName).toBe('serial')
      expect(overflow.requestedEnd).toBe(1002)
      expect(overflow.maxValue).toBe(999)
    }
  })
})

describe('release', () => {
  it(`frees a cancelled job's numbers for reuse`, () => {
    // The job printed nothing, so holding its span would skip those numbers
    // for no reason at all (FR-019).
    const templateId = seedTemplate()
    const jobId = seedJob('j1', templateId)
    allocator.allocate({ jobId, templateId, fields: [serial], copies: 10 })
    expect(allocator.suggest(templateId, serial).suggestedStart).toBe(11)

    allocator.release(jobId)

    expect(allocator.suggest(templateId, serial).suggestedStart).toBe(1)
  })
})

describe('per-copy values', () => {
  it('pads to the configured width', () => {
    const range = rangeFor(serial, 1, 80)
    // The width comes from the range itself, so a three-digit field that only
    // reaches 80 still prints 080.
    expect(valueAt(range, 0)).toBe('001')
    expect(valueAt(range, 79)).toBe('080')
  })

  it('gives every copy a different value', () => {
    const range = rangeFor(serial, 1, 80)
    const values = Array.from({ length: 80 }, (_unused, i) => valueAt(range, i))
    expect(new Set(values).size).toBe(80)
  })
})
