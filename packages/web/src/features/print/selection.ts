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

export const EMPTY: Selection = { kind: 'explicit', ordinals: [] }

/** What goes on the wire (see contracts/rest-api.md). */
export function toRowSelection(
  selection: Selection,
): { all: true } | { ranges: Array<[number, number]>; ids: number[] } {
  if (selection.kind === 'all') {
    return { all: true }
  }
  // Sent as individual ids rather than compressed into ranges: the server
  // sorts and de-duplicates anyway, and a compression bug here would be a
  // wrong batch that looks right on screen.
  return { ranges: [], ids: [...selection.ordinals].sort((a, b) => a - b) }
}

export function isSelected(selection: Selection, ordinal: number): boolean {
  return selection.kind === 'all' || selection.ordinals.includes(ordinal)
}

/**
 * Toggle one row.
 *
 * Toggling while "everything" is selected turns the selection explicit, taking
 * the whole table as its starting point — otherwise unticking one row would
 * silently clear the rest.
 */
export function toggle(selection: Selection, ordinal: number, allOrdinals: readonly number[]): Selection {
  if (selection.kind === 'all') {
    return { kind: 'explicit', ordinals: allOrdinals.filter((value) => value !== ordinal) }
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
): Selection {
  const current =
    selection.kind === 'all' ? [...allOrdinals] : [...selection.ordinals]
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
): boolean {
  return (
    pageOrdinals.length > 0 && pageOrdinals.every((ordinal) => isSelected(selection, ordinal))
  )
}

/** How many rows are selected, given the table's size. */
export function selectedCount(selection: Selection, total: number): number {
  return selection.kind === 'all' ? total : selection.ordinals.length
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
