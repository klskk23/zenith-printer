import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { SequenceAllocator, UnknownSequencePoolError } from '../../src/domain/sequence-allocator.ts'
import { SequenceOverflowError } from '../../src/domain/sequence-pool.ts'
import { SequencePoolRepo } from '../../src/db/repositories/sequence-pool-repo.ts'
import type { Clock, IdGenerator } from '../../src/clock.ts'

/**
 * Sequence claims.
 *
 * One asymmetry drives everything here: a skipped serial is a gap in a ledger,
 * a repeated serial is two boxes nobody can tell apart. The tests that matter
 * most are the ones that would catch a repeat.
 */
const clock: Clock = { now: () => new Date('2026-08-22T00:00:00Z') }

function harness() {
  const db = openDatabase({ location: ':memory:' })
  let n = 0
  const ids: IdGenerator = { next: () => `id-${(n += 1)}` }
  const pools = new SequencePoolRepo({ db, clock, ids })
  const allocator = new SequenceAllocator(db, clock, ids)

  let jobSeq = 0
  const seedJob = (): string => {
    jobSeq += 1
    const id = `job-${jobSeq}`
    db.prepare(
      `INSERT INTO print_jobs (id, idempotency_key, requested_copies, status, snapshot, created_at)
       VALUES (?, ?, 1, 'queued', '{}', '2026-08-22T00:00:00Z')`,
    ).run(id, `key-${jobSeq}`)
    return id
  }

  return { db, pools, allocator, seedJob }
}

describe('claiming', () => {
  it('starts at one when the pool has never issued a number', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 4, step: 1 })
    const claims = h.allocator.allocate({
      jobId: h.seedJob(),
      bindings: [{ variableName: 'serial', poolId: pool.id }],
      count: 5,
    })
    expect(claims).toEqual([
      { poolId: pool.id, variableName: 'serial', start: 1, end: 5, step: 1, digits: 4 },
    ])
  })

  it('continues where the previous batch stopped', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 4, step: 1 })
    const bindings = [{ variableName: 'serial', poolId: pool.id }]

    h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 5 })
    const second = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 5 })

    expect(second[0]).toMatchObject({ start: 6, end: 10 })
  })

  it('issues no number twice across ten consecutive batches', () => {
    // SC-004. Ten batches rather than two: an off-by-one in the continuation
    // shows up as an overlap of exactly one number, which two batches can hide.
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    const bindings = [{ variableName: 'serial', poolId: pool.id }]

    const issued: number[] = []
    for (let batch = 0; batch < 10; batch += 1) {
      const [claim] = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 5 })
      if (claim === undefined) throw new Error('no claim')
      for (let i = claim.start; i <= claim.end; i += claim.step) {
        issued.push(i)
      }
    }

    expect(issued).toHaveLength(50)
    expect(new Set(issued).size).toBe(50)
    // No gaps either: 1..50 exactly.
    expect(issued).toEqual(Array.from({ length: 50 }, (_unused, i) => i + 1))
  })

  it('draws two designs from one run of numbers', () => {
    // FR-005. A small-box label and a carton label sharing one serial run is
    // the reason pools exist as standalone objects. The old derivation narrowed
    // by template id, which made this silently issue each number twice.
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })

    const boxes = h.allocator.allocate({
      jobId: h.seedJob(),
      bindings: [{ variableName: '流水', poolId: pool.id }],
      count: 3,
    })
    const cartons = h.allocator.allocate({
      jobId: h.seedJob(),
      bindings: [{ variableName: 'serial', poolId: pool.id }],
      count: 3,
    })

    expect(boxes[0]).toMatchObject({ start: 1, end: 3 })
    expect(cartons[0]).toMatchObject({ start: 4, end: 6 })
  })

  it('honours a step larger than one', () => {
    const h = harness()
    const pool = h.pools.create({ name: '偶数', digits: 4, step: 2 })
    const claims = h.allocator.allocate({
      jobId: h.seedJob(),
      bindings: [{ variableName: 's', poolId: pool.id }],
      count: 3,
    })
    expect(claims[0]).toMatchObject({ start: 1, end: 5, step: 2 })
  })

  it('claims nothing when the design has no sequence variables', () => {
    const h = harness()
    expect(h.allocator.allocate({ jobId: h.seedJob(), bindings: [], count: 5 })).toEqual([])
  })

  it('refuses a pool that does not exist rather than inventing one', () => {
    const h = harness()
    expect(() =>
      h.allocator.allocate({
        jobId: h.seedJob(),
        bindings: [{ variableName: 's', poolId: 'gone' }],
        count: 1,
      }),
    ).toThrow(UnknownSequencePoolError)
  })
})

describe('overflow', () => {
  it('refuses rather than wrapping past the configured width', () => {
    // Wrapping 999 back to 000 reissues serials that are already on stock.
    const h = harness()
    const pool = h.pools.create({ name: '三位', digits: 3, step: 1 })
    expect(() =>
      h.allocator.allocate({
        jobId: h.seedJob(),
        bindings: [{ variableName: 's', poolId: pool.id }],
        count: 1000,
      }),
    ).toThrow(SequenceOverflowError)
  })

  it('rolls the whole allocation back, leaving no pool half-claimed', () => {
    const h = harness()
    const wide = h.pools.create({ name: '宽', digits: 6, step: 1 })
    const narrow = h.pools.create({ name: '窄', digits: 2, step: 1 })

    expect(() =>
      h.allocator.allocate({
        jobId: h.seedJob(),
        bindings: [
          { variableName: 'a', poolId: wide.id },
          { variableName: 'b', poolId: narrow.id },
        ],
        count: 500,
      }),
    ).toThrow(SequenceOverflowError)

    // The wide pool must not have kept its span: a claim left behind by a
    // rejected job burns those numbers for nothing.
    expect(h.pools.highestClaimed(wide.id)).toBeNull()
  })
})

describe('release', () => {
  it('gives the numbers back when a queued job is cancelled', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 4, step: 1 })
    const bindings = [{ variableName: 's', poolId: pool.id }]
    const jobId = h.seedJob()

    h.allocator.allocate({ jobId, bindings, count: 5 })
    h.allocator.release(jobId)

    expect(h.pools.highestClaimed(pool.id)).toBeNull()
    const next = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 1 })
    expect(next[0]).toMatchObject({ start: 1 })
  })
})

describe('the pool floor', () => {
  it('starts numbering from the floor when nothing has been issued', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    h.pools.setFloor(pool.id, 500)

    const claims = h.allocator.allocate({
      jobId: h.seedJob(),
      bindings: [{ variableName: 's', poolId: pool.id }],
      count: 2,
    })
    expect(claims[0]).toMatchObject({ start: 500, end: 501 })
  })

  it('resets forward, and the next batch starts at the new floor', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    const bindings = [{ variableName: 's', poolId: pool.id }]
    const jobId = h.seedJob()
    h.allocator.allocate({ jobId, bindings, count: 10 })

    h.pools.setFloor(pool.id, 1000)

    // The old claim is still on record — those numbers are on labels.
    expect(h.allocator.claimsFor(jobId)[0]).toMatchObject({ start: 1, end: 10 })
    const next = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 1 })
    expect(next[0]).toMatchObject({ start: 1000 })
  })

  it('can move numbering BACKWARDS, which is the whole point of a reset', () => {
    // A reset that could only go forwards would be a button that silently did
    // nothing, and the confirmation warning about duplicate serials would be
    // a lie. It can go backwards, and that is exactly why it is confirmed.
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    const bindings = [{ variableName: 's', poolId: pool.id }]
    h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 100 })

    h.pools.setFloor(pool.id, 5)

    const next = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 1 })
    expect(next[0]).toMatchObject({ start: 5 })
  })

  it('keeps the old claims on record even after numbering restarts below them', () => {
    // The numbers are on physical labels. Losing that record to make a counter
    // tidy would remove the only evidence of what was printed.
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    const bindings = [{ variableName: 's', poolId: pool.id }]
    const jobId = h.seedJob()
    h.allocator.allocate({ jobId, bindings, count: 100 })

    h.pools.setFloor(pool.id, 5)

    expect(h.allocator.claimsFor(jobId)).toHaveLength(1)
    expect(h.allocator.claimsFor(jobId)[0]).toMatchObject({ start: 1, end: 100 })
  })

  it('resumes from the new run, not the old one, after a backwards reset', () => {
    const h = harness()
    const pool = h.pools.create({ name: '整机流水', digits: 6, step: 1 })
    const bindings = [{ variableName: 's', poolId: pool.id }]
    h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 100 })
    h.pools.setFloor(pool.id, 5)
    h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 3 })

    const next = h.allocator.allocate({ jobId: h.seedJob(), bindings, count: 1 })
    expect(next[0]).toMatchObject({ start: 8 })
  })
})
