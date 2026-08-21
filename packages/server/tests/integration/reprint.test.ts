/**
 * Reprinting a failed job.
 *
 * A failure pauses the queue and tells the operator to count the labels and
 * reprint the shortfall — and until now there was nothing anywhere that could
 * do that. The advice named an action the system did not have.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

let app: FastifyInstance

beforeEach(async () => {
  app = await buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00.000Z'),
    idGenerator: new SequentialIdGenerator('id'),
  })
})

afterEach(async () => {
  await app.close()
})

/** A printer with capabilities, and a failed job of 100 that printed 60. */
async function seedFailedJob(pagesPrinted: number | null): Promise<string> {
  app.ctx.db
    .prepare(
      `INSERT INTO printers (id, name, kind, transport, address, dpi, printhead_pixels,
         density_min, density_max, density_default, paper_types, print_direction,
         supports_consumable_level, model, queue_state, created_at)
       VALUES ('prn-1','B3S_P','niimbot','serial','/dev/ttyACM0',203,384,1,5,3,'[1]','top',1,'B3S_P','running','2026-08-21T00:00:00Z')`,
    )
    .run()

  const snapshot = JSON.stringify({
    templateName: 'shipping',
    printerName: 'B3S_P',
    printerModel: 'B3S_P',
    printerKind: 'niimbot',
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    ir: { widthMm: 50, heightMm: 30, dpi: 203, elements: [] },
    profile: { name: 'stock', density: 3, labelType: 1 },
    offsetXDots: 0,
    offsetYDots: 0,
  })

  app.ctx.db
    .prepare(
      `INSERT INTO print_jobs (id, idempotency_key, printer_id, requested_copies, pages_printed,
         status, failure_code, snapshot, manual_field_values, seq_ranges, created_at)
       VALUES ('job-1','key-1','prn-1',100,?, 'failed','JOB_INTERRUPTED_BY_RESTART',?,'{}','{}','2026-08-21T00:00:00Z')`,
    )
    .run(pagesPrinted, snapshot)

  return 'job-1'
}

const jobCount = (): number =>
  Number((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM print_jobs').get() as { n: number }).n)

describe('reprinting', () => {
  it('creates a new job for the requested count', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 40 },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(40)
    expect(jobCount()).toBe(2)
  })

  /**
   * The count is the caller's, not the original's. Reprinting 100 when 60 are
   * already on the roll is exactly the mistake the failure message warns about.
   */
  it('does not reuse the original count', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 40 },
    })
    expect(res.json().requestedCopies).not.toBe(100)
  })

  it('works when the printed count is unknown', async () => {
    // The restart case: nobody can say how many came out, so the operator
    // counts them and supplies the number.
    await seedFailedJob(null)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 37 },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().requestedCopies).toBe(37)
  })

  it('reprints the snapshot, not the current template', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 5 },
    })
    const reprint = (await app.inject({ method: 'GET', url: `/api/print-jobs/${res.json().jobId}` })).json()
    // The design may have been edited or deleted since; a reprint has to match
    // what came out the first time (FR-050).
    expect(reprint.snapshot.templateName).toBe('shipping')
  })

  it('names the job it is a reprint of', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 5 },
    })
    expect(res.json().reprintOf).toBe('job-1')
  })

  it('leaves the original alone', async () => {
    await seedFailedJob(60)
    await app.inject({ method: 'POST', url: '/api/print-jobs/job-1/reprint', payload: { copies: 5 } })
    const original = (await app.inject({ method: 'GET', url: '/api/print-jobs/job-1' })).json()
    expect(original.status).toBe('failed')
  })

  /**
   * Resuming a paused queue says "the fault has been dealt with". Reprinting
   * must not say it on the operator's behalf.
   */
  it('refuses while the queue is paused', async () => {
    await seedFailedJob(60)
    app.ctx.db
      .prepare("UPDATE printers SET queue_state = 'paused', queue_paused_reason = 'JOB_INTERRUPTED_BY_RESTART'")
      .run()

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 40 },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('QUEUE_PAUSED')
  })

  it('queues nothing when it refuses', async () => {
    await seedFailedJob(60)
    app.ctx.db.prepare("UPDATE printers SET queue_state = 'paused'").run()
    await app.inject({ method: 'POST', url: '/api/print-jobs/job-1/reprint', payload: { copies: 40 } })
    expect(jobCount()).toBe(1)
  })

  it('404s for a job that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/nope/reprint',
      payload: { copies: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects a count of zero', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 0 },
    })
    expect(res.statusCode).toBe(400)
  })
})
