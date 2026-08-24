/**
 * Print history: how much of it comes back, and getting rid of the rest.
 *
 * Two things meet here. The list endpoint learned a `limit`, because a machine
 * that has been running a year should not ship a year of job snapshots across
 * the network to draw ten rows — and a snapshot carries a whole label IR.
 *
 * And history can now be pruned. That is the first thing in the product that
 * has ever deleted a `print_jobs` row, which is the reason for the third block
 * below: a sequence pool's current value is *not stored*. It is derived as a
 * MAX over the claims recorded against jobs (domain/sequence-pool.ts), and
 * `job_sequence_claims.job_id` used to be `ON DELETE CASCADE`. Deleting history
 * would have taken that evidence with it and rolled the counter backwards, so
 * the next batch would carry serials already sitting on labels in a box. With
 * foreign keys on and nothing ever deleting a job, the cascade had never fired
 * once — the feature and the fault would have arrived together.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { JobRepo } from '../../src/db/repositories/job-repo.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { SequencePoolRepo } from '../../src/db/repositories/sequence-pool-repo.ts'
import { SequenceAllocator } from '../../src/domain/sequence-allocator.ts'
import { SNAPSHOT } from '../support/queue-harness.ts'

let app: FastifyInstance
let clock: FixedClock
let printerId: string

function ctx() {
  return { db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids }
}

/**
 * One finished job, a minute after the last one.
 *
 * The clock is advanced rather than left fixed so that "most recent" is
 * decided by the timestamps under test, not by ids that happen to sort.
 */
function seedFinished(count: number): string[] {
  const jobs = new JobRepo(ctx())
  const ids: string[] = []
  for (let i = 0; i < count; i += 1) {
    clock.advance(60_000)
    const { job } = jobs.createOrGet({
      idempotencyKey: `key-${i}-${String(clock.now().getTime())}`,
      printerId,
      requestedCopies: 1,
      snapshot: SNAPSHOT,
    })
    jobs.markCompleted(job.id, 1)
    ids.push(job.id)
  }
  return ids
}

function seedQueued(): string {
  clock.advance(60_000)
  const { job } = new JobRepo(ctx()).createOrGet({
    idempotencyKey: `queued-${String(clock.now().getTime())}`,
    printerId,
    requestedCopies: 1,
    snapshot: SNAPSHOT,
  })
  return job.id
}

const list = async (query = '') =>
  (await app.inject({ method: 'GET', url: `/api/print-jobs${query}` })).json()

const prune = async (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/print-jobs/prune', payload })

beforeEach(async () => {
  clock = new FixedClock('2026-08-24T00:00:00Z')
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock,
    idGenerator: new SequentialIdGenerator('id'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
  printerId = new PrinterRepo(ctx()).create({
    name: 'fake',
    kind: 'niimbot',
    transport: 'serial',
    address: '/dev/fake',
    printTaskName: 'B1',
  }).id
})

afterEach(async () => {
  await app.close()
})

describe('how much history comes back', () => {
  it('still returns everything when nothing asks it not to', async () => {
    // The queue page reads the same endpoint. A default that truncated would
    // hide queued work from the one screen whose job is to show it.
    seedFinished(25)
    expect((await list()).jobs).toHaveLength(25)
  })

  it('returns only the most recent N when limit says so', async () => {
    const ids = seedFinished(25)
    const body = await list('?limit=10')

    expect(body.jobs).toHaveLength(10)
    // The last ten seeded, not the first ten stored.
    expect(body.jobs.map((job: { id: string }) => job.id)).toEqual(ids.slice(-10))
  })

  it('keeps the oldest-first order it has always returned', async () => {
    // The frontend reverses this itself. A limit that also flipped the order
    // would put history back to front without anything saying so.
    const ids = seedFinished(12)
    const returned = (await list('?limit=5')).jobs.map((job: { id: string }) => job.id)
    expect(returned).toEqual(ids.slice(-5))
  })

  it('says how many there are in all, so "show all 372" can say 372', async () => {
    seedFinished(25)
    const body = await list('?limit=10')
    expect(body.total).toBe(25)
  })

  it('counts what matches the filter, not the whole table', async () => {
    seedFinished(4)
    seedQueued()
    expect((await list('?finished=true')).total).toBe(4)
  })

  it('leaves unfinished jobs out when asked for finished ones', async () => {
    seedFinished(3)
    const queued = seedQueued()
    const body = await list('?finished=true&limit=10')
    expect(body.jobs.map((job: { id: string }) => job.id)).not.toContain(queued)
  })

  it('takes the most recent N from the finished ones, not from all of them', async () => {
    // Ten finished jobs and three queued: asking for the ten most recent
    // finished must not come back with seven because three slots went to work
    // that has not happened yet.
    const finished = seedFinished(10)
    seedQueued()
    seedQueued()
    seedQueued()
    const body = await list('?finished=true&limit=10')
    expect(body.jobs.map((job: { id: string }) => job.id)).toEqual(finished)
  })
})

describe('pruning history', () => {
  it('keeps the most recent N and deletes the rest', async () => {
    const ids = seedFinished(25)
    const res = await prune({ keep: 10 })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ deleted: 15, kept: 10 })
    expect((await list()).jobs.map((job: { id: string }) => job.id)).toEqual(ids.slice(-10))
  })

  it('does nothing when there is less history than that', async () => {
    seedFinished(4)
    expect((await prune({ keep: 10 })).json()).toMatchObject({ deleted: 0, kept: 4 })
  })

  it('never touches a job that is queued or printing', async () => {
    // Deleting the row under a running job would strand the queue on an id
    // that no longer resolves, and lose the count of what came out.
    seedFinished(3)
    const queued = seedQueued()
    await prune({ keep: 0 })

    const remaining = (await list()).jobs.map((job: { id: string }) => job.id)
    expect(remaining).toEqual([queued])
  })

  it('empties history when asked to keep none', async () => {
    seedFinished(6)
    expect((await prune({ keep: 0 })).json()).toMatchObject({ deleted: 6, kept: 0 })
  })

  it('refuses a negative keep rather than deleting something surprising', async () => {
    seedFinished(3)
    expect((await prune({ keep: -1 })).statusCode).toBe(400)
    expect((await list()).jobs).toHaveLength(3)
  })
})

describe('the numbers already on labels', () => {
  /** A pool, and a finished job that drew `count` numbers from it. */
  function seedNumberedJob(poolId: string, count: number): string {
    clock.advance(60_000)
    const jobs = new JobRepo(ctx())
    const { job } = jobs.createOrGet({
      idempotencyKey: `seq-${String(clock.now().getTime())}`,
      printerId,
      requestedCopies: count,
      snapshot: SNAPSHOT,
    })
    new SequenceAllocator(app.ctx.db, app.ctx.clock, app.ctx.ids).allocate({
      jobId: job.id,
      bindings: [{ poolId, variableName: 'sn' }],
      count,
    })
    jobs.markCompleted(job.id, count)
    return job.id
  }

  it('does not roll the counter back when the job that used them is deleted', async () => {
    const pools = new SequencePoolRepo(ctx())
    const pool = pools.create({ name: '整机流水', digits: 6, step: 1 })
    seedNumberedJob(pool.id, 741)
    expect(pools.highestClaimed(pool.id)).toBe(741)

    await prune({ keep: 0 })

    // The job is gone; the evidence of which numbers went onto labels is not.
    expect(pools.highestClaimed(pool.id)).toBe(741)
  })

  it('issues the next number, not one already printed', async () => {
    const pools = new SequencePoolRepo(ctx())
    const pool = pools.create({ name: '整机流水', digits: 6, step: 1 })
    seedNumberedJob(pool.id, 741)

    await prune({ keep: 0 })

    const pool2 = pools.find(pool.id)!
    const next = new SequenceAllocator(app.ctx.db, app.ctx.clock, app.ctx.ids).suggest(pool2)
    expect(next.start).toBe(742)
  })
})
