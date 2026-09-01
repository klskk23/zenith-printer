/**
 * Merging a fetched table into a stored one, by key rather than by position.
 *
 * The rule this replaces: every write path rebuilt the whole table and
 * renumbered 1..n, so a row's identity *was* its ordinal. For a table somebody
 * edits and then prints from, that is sound — they are looking at it. For a
 * table that changes on its own it is not: an upstream insert shifts everything
 * below it, a selection of ordinals silently comes to mean different rows, and
 * nothing notices, because those ordinals still exist.
 *
 * So identity moves to a column the producer guarantees. Ordinals stay dense
 * 1..n — the row editor's patch path and the browser's select-all both depend
 * on that — but they become an ordering, not a name.
 *
 * **Rows that survive keep their place.** New keys go on the end rather than
 * being interleaved in the producer's order. Adopting the producer's order
 * would reshuffle a table under somebody who is reading it, to no purpose:
 * order here is for finding a row by eye, and the thing that decides which rows
 * print is the key.
 */

export interface KeyedRow {
  key: string
  values: Record<string, string>
}

export class DuplicateRowKeyError extends Error {
  readonly column: string
  readonly duplicates: string[]

  constructor(column: string, duplicates: string[]) {
    super(`column "${column}" repeats: ${duplicates.join(', ')}`)
    this.name = 'DuplicateRowKeyError'
    this.column = column
    this.duplicates = duplicates
  }
}

export class MissingRowKeyError extends Error {
  readonly column: string
  readonly rowIndex: number

  constructor(column: string, rowIndex: number) {
    super(`row ${rowIndex + 1} has no value in the key column "${column}"`)
    this.name = 'MissingRowKeyError'
    this.column = column
    this.rowIndex = rowIndex
  }
}

/**
 * Read each row's key, refusing the two ways a key column can fail to be one.
 *
 * Both are refused loudly rather than worked around. Dropping an unkeyed row
 * would lose data nobody asked to lose; keeping one of a duplicated pair would
 * make "the row with this key" mean whichever came first, which is the kind of
 * thing that is correct in testing and wrong at scale.
 */
export function keyRows(
  rows: readonly Record<string, string>[],
  keyColumn: string,
): KeyedRow[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const keyed: KeyedRow[] = []

  for (const [index, values] of rows.entries()) {
    const key = (values[keyColumn] ?? '').trim()
    if (key.length === 0) {
      throw new MissingRowKeyError(keyColumn, index)
    }
    if (seen.has(key)) {
      duplicates.add(key)
    }
    seen.add(key)
    keyed.push({ key, values })
  }

  if (duplicates.size > 0) {
    // Every offending value, not the first: fixing one at a time upstream and
    // refetching is a slow way to find out there were nine.
    throw new DuplicateRowKeyError(keyColumn, [...duplicates].sort())
  }
  return keyed
}

export interface UpsertPlan {
  /** The table as it should end up, in order. Ordinals are the positions here. */
  rows: KeyedRow[]
  added: number
  updated: number
  removed: number
}

/**
 * What the stored table should become.
 *
 * Not a diff to apply in place — the caller writes `rows` — but the counts come
 * back so the refresh can say what it did. "Applied" with no numbers is
 * indistinguishable from "did nothing", and those are different answers.
 */
export function planUpsert(
  existing: readonly KeyedRow[],
  incoming: readonly KeyedRow[],
): UpsertPlan {
  const arriving = new Map(incoming.map((row) => [row.key, row.values]))
  const held = new Set(existing.map((row) => row.key))

  const kept: KeyedRow[] = []
  let updated = 0
  for (const row of existing) {
    const values = arriving.get(row.key)
    if (values === undefined) {
      continue
    }
    // Replaced whole, not merged: a column the producer stopped sending is a
    // column that is gone, and merging would leave its last value behind
    // looking current.
    if (JSON.stringify(values) !== JSON.stringify(row.values)) {
      updated += 1
    }
    kept.push({ key: row.key, values })
  }

  const appended = incoming.filter((row) => !held.has(row.key))

  return {
    rows: [...kept, ...appended],
    added: appended.length,
    updated,
    removed: existing.length - kept.length,
  }
}
