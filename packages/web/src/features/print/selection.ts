/**
 * Row-selection state for the print dialog.
 *
 * Three ways in — tick boxes, type a range, take everything — and they are kept
 * as three shapes rather than one expanded list. "Everything" in particular has
 * to survive as an intent: the server evaluates it at submission, so a row
 * added in the meantime is included, which an expanded list could not express.
 */

/**
 * Labels one job may produce. Mirrors the server's ceiling so the dialog can
 * say so before the request goes out, rather than after a round trip.
 */
export const MAX_LABELS_PER_JOB = 1000

export type Selection =
  | { kind: 'all' }
  | { kind: 'explicit'; ordinals: number[] }
  /**
   * Rows named by their key column.
   *
   * A separate kind rather than keys carried alongside ordinals, because for a
   * table that refreshes from elsewhere the key *is* the selection: ordinals
   * move when the producer inserts or deletes, and a selection stored as
   * ordinals would have to be thrown away after every refresh — which is
   * exactly what this replaces.
   */
  | { kind: 'keys'; keys: string[] }

/** A row's key, for the rows currently on screen. */
export type KeyLookup = (ordinal: number) => string | undefined

export const EMPTY: Selection = { kind: 'explicit', ordinals: [] }

/**
 * What goes on the wire (see contracts/rest-api.md).
 *
 * With a key column, the rows are named by key. That is the whole purchase: a
 * table that refreshes between choosing and submitting moves its rows, and an
 * ordinal that still exists but now names a different row is a wrong batch that
 * looks entirely right. A key that is gone is refused, loudly.
 *
 * Without one, positions — which is every table anybody maintains by hand, and
 * exactly what this did before.
 */
export function toRowSelection(
  selection: Selection,
): { all: true } | { ranges: Array<[number, number]>; ids: number[]; keys: string[] } {
  if (selection.kind === 'all') {
    return { all: true }
  }
  if (selection.kind === 'keys') {
    return { ranges: [], ids: [], keys: [...selection.keys].sort() }
  }
  // Sent as individual ids rather than compressed into ranges: the server
  // sorts and de-duplicates anyway, and a compression bug here would be a
  // wrong batch that looks right on screen.
  return { ranges: [], ids: [...selection.ordinals].sort((a, b) => a - b), keys: [] }
}

export function isSelected(selection: Selection, ordinal: number, keyOf?: KeyLookup): boolean {
  if (selection.kind === 'all') {
    return true
  }
  if (selection.kind === 'keys') {
    const key = keyOf?.(ordinal)
    return key !== undefined && selection.keys.includes(key)
  }
  return selection.ordinals.includes(ordinal)
}

/**
 * Toggle one row.
 *
 * Toggling while "everything" is selected turns the selection explicit, taking
 * the whole table as its starting point — otherwise unticking one row would
 * silently clear the rest.
 */
export function toggle(
  selection: Selection,
  ordinal: number,
  allOrdinals: readonly number[],
  keyOf?: KeyLookup,
): Selection {
  // A keyed table ticks by key. The row is on screen to be ticked, so its key
  // is known; there is no case where this has to guess.
  if (keyOf !== undefined) {
    const key = keyOf(ordinal)
    if (key === undefined) {
      return selection
    }
    const current = selection.kind === 'keys' ? selection.keys : []
    return {
      kind: 'keys',
      keys: current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    }
  }

  if (selection.kind === 'all') {
    return { kind: 'explicit', ordinals: allOrdinals.filter((value) => value !== ordinal) }
  }
  if (selection.kind === 'keys') {
    return selection
  }
  const has = selection.ordinals.includes(ordinal)
  return {
    kind: 'explicit',
    ordinals: has
      ? selection.ordinals.filter((value) => value !== ordinal)
      : [...selection.ordinals, ordinal],
  }
}

/**
 * Add or remove every row on the page in view.
 *
 * A page-wide tick is a convenience, not a second kind of selection: it adds
 * these ordinals to whatever was already chosen. Replacing the selection
 * instead would make paging forward and ticking twice a way to lose the first
 * page without noticing.
 *
 * Untick when the page is already wholly selected, which is what makes the same
 * control able to undo itself.
 */
export function togglePage(
  selection: Selection,
  pageOrdinals: readonly number[],
  allOrdinals: readonly number[],
  keyOf?: KeyLookup,
): Selection {
  if (keyOf !== undefined) {
    const pageKeys = pageOrdinals.map(keyOf).filter((key): key is string => key !== undefined)
    const chosen = new Set(selection.kind === 'keys' ? selection.keys : [])
    const wholePage = pageKeys.length > 0 && pageKeys.every((key) => chosen.has(key))
    for (const key of pageKeys) {
      if (wholePage) {
        chosen.delete(key)
      } else {
        chosen.add(key)
      }
    }
    return { kind: 'keys', keys: [...chosen] }
  }

  const current =
    selection.kind === 'all' ? [...allOrdinals] : selection.kind === 'keys' ? [] : [...selection.ordinals]
  const chosen = new Set(current)
  const wholePageChosen =
    pageOrdinals.length > 0 && pageOrdinals.every((ordinal) => chosen.has(ordinal))

  if (wholePageChosen) {
    const onPage = new Set(pageOrdinals)
    return { kind: 'explicit', ordinals: current.filter((ordinal) => !onPage.has(ordinal)) }
  }
  for (const ordinal of pageOrdinals) {
    chosen.add(ordinal)
  }
  // Sorted, so the stored order never suggests a print order. Printing is by
  // ascending ordinal regardless, and a selection listed in tick order would
  // invite somebody to assume otherwise.
  return { kind: 'explicit', ordinals: [...chosen].sort((a, b) => a - b) }
}

/** Whether every row on the page in view is selected. */
export function isPageSelected(
  selection: Selection,
  pageOrdinals: readonly number[],
  keyOf?: KeyLookup,
): boolean {
  return (
    pageOrdinals.length > 0 && pageOrdinals.every((ordinal) => isSelected(selection, ordinal, keyOf))
  )
}

/** How many rows are selected, given the table's size. */
export function selectedCount(selection: Selection, total: number): number {
  if (selection.kind === 'all') {
    return total
  }
  return selection.kind === 'keys' ? selection.keys.length : selection.ordinals.length
}

/**
 * Parse a range expression like `5-12`, or a list like `5-12, 20, 31-33`.
 *
 * Returns null for anything it cannot read, so the field can say "that is not a
 * range" rather than silently selecting nothing.
 */
export function parseRange(input: string, total: number): number[] | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return null
  }

  const ordinals = new Set<number>()
  for (const part of trimmed.split(/[,，、]/)) {
    const piece = part.trim()
    if (piece.length === 0) continue

    const range = /^(\d+)\s*[-–~]\s*(\d+)$/.exec(piece)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      const [low, high] = from <= to ? [from, to] : [to, from]
      if (low < 1 || high > total) return null
      for (let ordinal = low; ordinal <= high; ordinal += 1) ordinals.add(ordinal)
      continue
    }

    if (!/^\d+$/.test(piece)) return null
    const single = Number(piece)
    if (single < 1 || single > total) return null
    ordinals.add(single)
  }

  return ordinals.size === 0 ? null : [...ordinals].sort((a, b) => a - b)
}

/** Total labels this selection will produce. */
export function labelTotal(selection: Selection, total: number, copies: number): number {
  return selectedCount(selection, total) * copies
}
