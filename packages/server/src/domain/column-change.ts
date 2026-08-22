/**
 * What changed about a worksheet's header between two refreshes.
 *
 * **Google cannot tell a rename from a delete-plus-add**, and neither can this.
 * Only the resulting header comes back, so "收件人 was renamed to 客户名称" and
 * "收件人 was deleted, 客户名称 was added" are the same bytes. The rule is
 * therefore the difference alone: a column the old header had and the new one
 * does not is breaking, whatever became of it.
 *
 * Do not try to infer renames here. Any heuristic — position, similarity — is
 * wrong about as often as it is right, and being wrong means a design silently
 * bound to the wrong column.
 */

export type ColumnChange =
  | { kind: 'unchanged' }
  | { kind: 'added'; added: string[] }
  | { kind: 'breaking'; removed: string[]; added: string[] }

export function classifyColumnChange(
  before: readonly string[],
  after: readonly string[],
): ColumnChange {
  const had = new Set(before)
  const has = new Set(after)

  // Order is not a change: a row is keyed by column name, so moving a column
  // sideways in the spreadsheet means nothing here.
  const removed = before.filter((name) => !has.has(name))
  const added = after.filter((name) => !had.has(name))

  if (removed.length > 0) {
    return { kind: 'breaking', removed, added }
  }
  if (added.length > 0) {
    return { kind: 'added', added }
  }
  return { kind: 'unchanged' }
}
