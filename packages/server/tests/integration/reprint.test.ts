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
    rows: [],
    copiesPerRow: 1,
    constants: {},
  })

  app.ctx.db
    .prepare(
      `INSERT INTO print_jobs (id, idempotency_key, printer_id, requested_copies, pages_printed,
         status, failure_code, snapshot, created_at)
       VALUES ('job-1','key-1','prn-1',100,?, 'failed','JOB_INTERRUPTED_BY_RESTART',?,'2026-08-21T00:00:00Z')`,
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

/** A second printer of the same kind, at a different head resolution. */
function seedSecondPrinter(
  id = 'prn-2',
  kind = 'niimbot',
  dpi = 300,
  offsetX = 7,
): void {
  app.ctx.db
    .prepare(
      `INSERT INTO printers (id, name, kind, transport, address, dpi, printhead_pixels,
         density_min, density_max, density_default, paper_types, print_direction,
         supports_consumable_level, model, queue_state, offset_x_dots, offset_y_dots, created_at)
       VALUES (?,?,?,'serial','/dev/ttyACM1',?,576,1,5,4,'[1]','top',1,'B1','running',?,0,'2026-08-21T00:00:00Z')`,
    )
    .run(id, `printer-${id}`, kind, dpi, offsetX)
}

function seedProfile(id: string, printerId: string, density: number): void {
  app.ctx.db
    .prepare(
      `INSERT INTO profiles (id, printer_id, name, density, label_type, created_at)
       VALUES (?,?,?,?,2,'2026-08-21T00:00:00Z')`,
    )
    .run(id, printerId, `profile-${id}`, density)
}

const snapshotOf = (jobId: string): Record<string, never> =>
  JSON.parse(
    String(
      (app.ctx.db.prepare('SELECT snapshot FROM print_jobs WHERE id = ?').get(jobId) as {
        snapshot: string
      }).snapshot,
    ),
  )

const newestJob = (): string =>
  String(
    (app.ctx.db
      .prepare("SELECT id FROM print_jobs WHERE id <> 'job-1' ORDER BY rowid DESC LIMIT 1")
      .get() as { id: string }).id,
  )

describe('choosing a different printer', () => {
  it('sends the reprint to the printer that was asked for', async () => {
    // The first machine may be busy, out of stock, or the one that jammed.
    await seedFailedJob(60)
    seedSecondPrinter()

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 5, printerId: 'prn-2' },
    })
    expect(res.statusCode).toBe(202)

    const row = app.ctx.db
      .prepare('SELECT printer_id FROM print_jobs WHERE id = ?')
      .get(newestJob()) as { printer_id: string }
    expect(row.printer_id).toBe('prn-2')
  })

  it('re-grids the design for the new head instead of printing it at the old size', async () => {
    // The snapshot was baked at 203 dpi. Sending those dots to a 300 dpi head
    // would print the label two-thirds the size it should be — the design is
    // millimetres, and the dot grid belongs to whichever printer is running it.
    await seedFailedJob(60)
    seedSecondPrinter('prn-2', 'niimbot', 300)

    await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, printerId: 'prn-2' },
    })

    const snapshot = snapshotOf(newestJob()) as unknown as {
      dpi: number
      ir: { dpi: number }
      printerName: string
      offsetXDots: number
    }
    expect(snapshot.dpi).toBe(300)
    expect(snapshot.ir.dpi).toBe(300)
    // And the record says which machine actually ran it.
    expect(snapshot.printerName).toBe('printer-prn-2')
    // Position correction is the new printer's; the old one's was measured
    // against paper that is no longer under this head.
    expect(snapshot.offsetXDots).toBe(7)
  })

  it('keeps what the reprint is a copy of', async () => {
    // Rebuilding the snapshot must not lose the parts that make it a record:
    // which design it was, and the constants it was printed with.
    await seedFailedJob(60)
    seedSecondPrinter()

    await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, printerId: 'prn-2' },
    })

    const snapshot = snapshotOf(newestJob()) as unknown as { templateName: string }
    expect(snapshot.templateName).toBe('shipping')
  })

  it('refuses a printer of a different kind', async () => {
    // A design is bound to a printer kind when it is drawn. Reprinting a
    // NIIMBOT label on a ZPL machine is a new decision, not a repeat of an old
    // one, and the label it produced would not be the label being reprinted.
    await seedFailedJob(60)
    seedSecondPrinter('prn-zpl', 'zpl', 203)

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, printerId: 'prn-zpl' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('PRINTER_KIND_MISMATCH')
  })

  it('404s for a printer that does not exist', async () => {
    await seedFailedJob(60)
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, printerId: 'nope' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('still uses the original printer when none is named', async () => {
    await seedFailedJob(60)
    seedSecondPrinter()

    await app.inject({ method: 'POST', url: '/api/print-jobs/job-1/reprint', payload: { copies: 1 } })
    const row = app.ctx.db
      .prepare('SELECT printer_id FROM print_jobs WHERE id = ?')
      .get(newestJob()) as { printer_id: string }
    expect(row.printer_id).toBe('prn-1')
  })
})

describe('choosing different print parameters', () => {
  it('prints with the profile that was asked for', async () => {
    // The commonest reason to reprint from history: it came out too light.
    await seedFailedJob(60)
    seedProfile('pro-9', 'prn-1', 5)

    await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, profileId: 'pro-9' },
    })

    const snapshot = snapshotOf(newestJob()) as unknown as {
      profile: { density: number; labelType: number; name: string }
    }
    expect(snapshot.profile.density).toBe(5)
    expect(snapshot.profile.labelType).toBe(2)
    expect(snapshot.profile.name).toBe('profile-pro-9')
  })

  it('refuses a profile belonging to another printer', async () => {
    // Profiles are per printer — density and label type mean something only
    // against a particular head. Silently accepting one from elsewhere would
    // print at settings nobody chose for this machine.
    await seedFailedJob(60)
    seedSecondPrinter()
    seedProfile('pro-other', 'prn-2', 5)

    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs/job-1/reprint',
      payload: { copies: 1, profileId: 'pro-other' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('PROFILE_PRINTER_MISMATCH')
  })

  it('keeps the original settings when none are named', async () => {
    // Today's behaviour, and the default: a reprint reproduces what came out.
    await seedFailedJob(60)
    await app.inject({ method: 'POST', url: '/api/print-jobs/job-1/reprint', payload: { copies: 1 } })

    const snapshot = snapshotOf(newestJob()) as unknown as { profile: { density: number } }
    expect(snapshot.profile.density).toBe(3)
  })
})
