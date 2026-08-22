/**
 * Data moves for the retirement of variable fields.
 *
 * Two steps, deliberately in separate migrations because one reads a column the
 * other drops.
 */
import type { Database } from '../index.ts'

interface LegacyRange {
  start: number
  end: number
  step: number
  digits: number
}

/**
 * Move `print_jobs.seq_ranges` into `job_sequence_claims`.
 *
 * Legacy ranges are keyed by *field name* and belong to a template, not to a
 * pool — pools did not exist. Each distinct field name becomes a pool, so the
 * numbers already on labels stay claimed and cannot be reissued.
 *
 * Skipping this and simply dropping the column would make every pool start
 * from zero, and a reissued serial is two boxes nobody can tell apart.
 */
export function claimsFromSeqRanges(db: Database, log: (event: Record<string, unknown>) => void): void {
  const jobs = db.prepare("SELECT id, template_id, seq_ranges FROM print_jobs WHERE seq_ranges <> '{}'").all()
  if (jobs.length === 0) {
    return
  }

  const poolIdFor = new Map<string, string>()
  const insertPool = db.prepare(
    'INSERT INTO sequence_pools (id, name, digits, step, floor, created_at) VALUES (?, ?, ?, ?, 0, ?)',
  )
  const insertClaim = db.prepare(
    `INSERT INTO job_sequence_claims (job_id, pool_id, variable_name, start_value, end_value, step, digits)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const now = new Date(0).toISOString()

  for (const job of jobs) {
    let ranges: Record<string, LegacyRange>
    try {
      ranges = JSON.parse(String(job.seq_ranges)) as Record<string, LegacyRange>
    } catch {
      // Unparseable history is reported, not silently dropped: those numbers
      // are on physical labels and somebody may need to reconcile them.
      log({ event: 'seq_ranges_unparseable', jobId: String(job.id), raw: String(job.seq_ranges) })
      continue
    }

    for (const [name, range] of Object.entries(ranges)) {
      let poolId = poolIdFor.get(name)
      if (poolId === undefined) {
        poolId = `pool-migrated-${poolIdFor.size + 1}`
        poolIdFor.set(name, poolId)
        insertPool.run(poolId, name, range.digits, range.step, now)
        log({ event: 'sequence_pool_created', poolId, name, digits: range.digits, step: range.step })
      }
      // One claim per (job, pool). A job that used two fields sharing a name
      // cannot exist, since field names were unique within a template.
      insertClaim.run(String(job.id), poolId, name, range.start, range.end, range.step, range.digits)
    }
  }
}

/**
 * Rewrite element content into the `${}` grammar.
 *
 * Two changes, and the second is the one that matters:
 *
 *   { $var: 'x' }  →  '${x}'
 *   literal '${'   →  '$${'
 *
 * Without the escaping pass, content that used to print the characters "${x}"
 * would start resolving as a reference — the label changes meaning with nothing
 * anywhere saying so.
 */
export function rewriteElementContent(db: Database, log: (event: Record<string, unknown>) => void): void {
  const templates = db.prepare('SELECT id, elements FROM templates').all()
  const update = db.prepare('UPDATE templates SET elements = ? WHERE id = ?')

  for (const template of templates) {
    let elements: unknown
    try {
      elements = JSON.parse(String(template.elements))
    } catch {
      log({ event: 'template_elements_unparseable', templateId: String(template.id) })
      continue
    }
    if (!Array.isArray(elements)) {
      continue
    }

    let changed = false
    const rewritten = elements.map((element: unknown) => {
      if (typeof element !== 'object' || element === null || !('content' in element)) {
        return element
      }
      const content = (element as { content: unknown }).content

      if (typeof content === 'object' && content !== null && '$var' in content) {
        changed = true
        return { ...element, content: `\${${String((content as { $var: unknown }).$var)}}` }
      }
      if (typeof content === 'string' && content.includes('$')) {
        // Escape the dollar, which is what the grammar escapes. `$${` then
        // reads as (escaped $) + literal `{`, reproducing the original text.
        const escaped = content.replace(/\$/g, '$$$$')
        if (escaped !== content) {
          changed = true
          return { ...element, content: escaped }
        }
      }
      return element
    })

    if (changed) {
      update.run(JSON.stringify(rewritten), String(template.id))
      log({ event: 'template_content_rewritten', templateId: String(template.id) })
    }
  }
}
