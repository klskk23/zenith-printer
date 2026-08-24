/**
 * Migration 15, and the trap inside it.
 *
 * The migration rebuilds `job_sequence_claims` to drop `ON DELETE CASCADE` on
 * the job, so that pruning print history cannot take the record of which
 * serials were printed with it.
 *
 * Rebuilding a table in SQLite means copying the rows, and copying them
 * renumbers the rowids — which matters here because
 * `sequence_pools.floor_watermark` *is* a rowid from this table: claims at or
 * below it predate the last reset and stop counting towards the current value.
 * Releasing a cancelled job's claim leaves gaps, so a renumbered copy lands
 * *below* the old numbers, pushing post-reset claims under the watermark and
 * rolling the counter backwards — the very fault the migration is for,
 * reintroduced by it. Hence the explicit rowid in the INSERT, and hence this.
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/index.ts'
import { migrations } from '../../src/db/migrations/index.ts'
import { SequencePoolRepo } from '../../src/db/repositories/sequence-pool-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

const BEFORE = migrations.filter((m) => m.id <= 14)

function seedJob(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO print_jobs (id, idempotency_key, requested_copies, status, snapshot, created_at)
     VALUES (?, ?, 1, 'completed', '{}', '2026-08-24T00:00:00.000Z')`,
  ).run(id, `key-${id}`)
}

function seedClaim(db: DatabaseSync, jobId: string, poolId: string, end: number): void {
  db.prepare(
    `INSERT INTO job_sequence_claims (job_id, pool_id, variable_name, start_value, end_value, step, digits)
     VALUES (?, ?, 'sn', ?, ?, 1, 6)`,
  ).run(jobId, poolId, end, end)
}

/**
 * A database on migration 14 with five claims, two of them since released —
 * which is what leaves the rowid gaps that make this worth testing.
 */
function seeded(): { db: DatabaseSync; poolId: string } {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db, BEFORE)

  const poolId = 'pool-1'
  db.prepare(
    `INSERT INTO sequence_pools (id, name, digits, step, floor, floor_watermark, created_at)
     VALUES (?, '整机流水', 6, 1, 0, 0, '2026-08-24T00:00:00.000Z')`,
  ).run(poolId)

  for (let i = 1; i <= 5; i += 1) {
    seedJob(db, `job-${i}`)
    seedClaim(db, `job-${i}`, poolId, i * 100)
  }
  // Two jobs were cancelled and gave their numbers back. Rowids 1, 4, 5 remain.
  db.exec("DELETE FROM job_sequence_claims WHERE job_id IN ('job-2','job-3')")

  return { db, poolId }
}

function rowids(db: DatabaseSync): Array<{ rowid: number; end: number }> {
  return db
    .prepare('SELECT rowid, end_value FROM job_sequence_claims ORDER BY rowid')
    .all()
    .map((row) => ({ rowid: Number(row.rowid), end: Number(row.end_value) }))
}

const pools = (db: DatabaseSync) =>
  new SequencePoolRepo({ db, clock: new FixedClock('2026-08-24T00:00:00Z'), ids: new SequentialIdGenerator() })

describe('rebuilding the claims table', () => {
  it('carries the rowids across rather than renumbering them', () => {
    const { db } = seeded()
    const before = rowids(db)
    expect(before).toEqual([{ rowid: 1, end: 100 }, { rowid: 4, end: 400 }, { rowid: 5, end: 500 }])

    runMigrations(db, migrations)

    expect(rowids(db)).toEqual(before)
  })

  it('leaves a reset where it was, instead of undoing it', () => {
    // Watermark 4: everything up to and including rowid 4 predates the last
    // reset, so only the claim ending at 500 still counts. Renumbering would
    // move that claim to rowid 3, put it under the watermark, and drop the
    // pool's current value from 500 back to its floor.
    const { db, poolId } = seeded()
    db.prepare('UPDATE sequence_pools SET floor_watermark = 4 WHERE id = ?').run(poolId)
    expect(pools(db).highestClaimed(poolId)).toBe(500)

    runMigrations(db, migrations)

    expect(pools(db).highestClaimed(poolId)).toBe(500)
  })

  it('keeps every claim row', () => {
    const { db } = seeded()
    runMigrations(db, migrations)
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_sequence_claims').get()?.n).toBe(3)
  })

  it('keeps the index the pool lookup depends on', () => {
    // Without it, every submission scans the whole claim table.
    const { db } = seeded()
    runMigrations(db, migrations)
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='job_sequence_claims'")
      .all()
      .map((row) => String(row.name))
    expect(names).toContain('idx_job_sequence_claims_pool')
  })
})

describe('what deleting takes with it', () => {
  it('no longer removes a claim when its job is deleted', () => {
    const { db, poolId } = seeded()
    runMigrations(db, migrations)

    db.exec("DELETE FROM print_jobs WHERE id = 'job-5'")

    expect(pools(db).highestClaimed(poolId)).toBe(500)
  })

  it('still removes claims when the pool itself is deleted', () => {
    // A pool is the numbering scheme. Claims against a scheme that no longer
    // exists are evidence of nothing, and nothing can derive from them.
    const { db, poolId } = seeded()
    runMigrations(db, migrations)

    db.prepare('DELETE FROM sequence_pools WHERE id = ?').run(poolId)

    expect(db.prepare('SELECT COUNT(*) AS n FROM job_sequence_claims').get()?.n).toBe(0)
  })

  it('did remove them before, which is the whole reason for this migration', () => {
    // Guards the premise: if this ever stops being true, the migration above
    // is solving a problem that no longer exists and should be questioned.
    const { db, poolId } = seeded()

    db.exec("DELETE FROM print_jobs WHERE id = 'job-5'")

    expect(pools(db).highestClaimed(poolId)).toBe(400)
  })
})
