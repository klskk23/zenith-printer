/**
 * Which rows of a data source one job prints.
 *
 * Kept compact rather than expanded in the browser, because `all` has to mean
 * "the table as it stands when this is submitted" — an expanded list cannot say
 * that, and a table that gained a row between ticking and submitting would
 * quietly print the wrong batch.
 *
 * Ordinals are positions in the table, 1-based: the same numbers a "5-12" range
 * refers to and the same ones shown beside each row.
 */
/**
 * Accepted loosely on purpose: the parsed schema fills both arrays in, but
 * callers and tests routinely name just one, and requiring the other adds
 * nothing but ceremony.
 */
export type SelectionInput =
  | { all: true }
  | {
      ranges?: readonly (readonly [number, number])[]
      ids?: readonly number[]
      /** Rows named by key, for a table whose rows move under it. */
      keys?: readonly string[]
    }

export class StaleRowSelectionError extends Error {
  readonly missingOrdinals: number[]
  /** Keys the table no longer has. Empty for a selection made by position. */
  readonly missingKeys: string[]

  constructor(missingOrdinals: number[], missingKeys: string[] = []) {
    const named = [...missingOrdinals.map(String), ...missingKeys]
    super(`selected row(s) no longer exist: ${named.join(', ')}`)
    this.name = 'StaleRowSelectionError'
    this.missingOrdinals = missingOrdinals
    this.missingKeys = missingKeys
  }
}

/**
 * Turn a selection into the ordinals to print, in table order.
 *
 * Always sorted, never in the order things were ticked: the labels come off the
 * printer in a stack, and a stack in ticking order is a stack nobody can check
 * against the spreadsheet (FR-037).
 *
 * `existing` is the set of ordinals the table currently has. An explicit
 * selection naming a row that has since been deleted is **refused** rather than
 * silently skipped: somebody who selected eight rows expects eight labels, and
 * printing seven without saying so leaves a discrepancy to be found at
 * counting time. `all` is exempt — it is defined as "whatever is there now".
 */
export function expandSelection(
  selection: SelectionInput,
  existing: readonly number[],
  /**
   * Key to ordinal, for a table that has a key column.
   *
   * Optional because most tables do not: a CSV somebody uploaded has no
   * identity beyond its order, and inventing one would be pretending.
   */
  ordinalByKey?: ReadonlyMap<string, number>,
): number[] {
  const available = new Set(existing)

  if ('all' in selection) {
    return [...available].sort((a, b) => a - b)
  }

  const wanted = new Set<number>()
  for (const [from, to] of selection.ranges ?? []) {
    const [low, high] = from <= to ? [from, to] : [to, from]
    for (let ordinal = low; ordinal <= high; ordinal += 1) {
      wanted.add(ordinal)
    }
  }
  for (const ordinal of selection.ids ?? []) {
    wanted.add(ordinal)
  }

  /**
   * A key with no row is refused the same way a missing ordinal is — and here
   * the refusal finally means what it says. Selecting eight rows and printing
   * seven leaves a discrepancy for counting time to find.
   */
  const missingKeys: string[] = []
  for (const key of selection.keys ?? []) {
    const ordinal = ordinalByKey?.get(key)
    if (ordinal === undefined) {
      missingKeys.push(key)
      continue
    }
    wanted.add(ordinal)
  }

  const missing = [...wanted].filter((ordinal) => !available.has(ordinal)).sort((a, b) => a - b)
  if (missing.length > 0 || missingKeys.length > 0) {
    throw new StaleRowSelectionError(missing, missingKeys.sort())
  }

  return [...wanted].sort((a, b) => a - b)
}

/** How many labels a submission would produce. */
export function labelCount(rowCount: number, copiesPerRow: number): number {
  return rowCount * copiesPerRow
}
