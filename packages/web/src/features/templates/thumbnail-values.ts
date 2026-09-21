/**
 * What a gallery thumbnail fills its variable fields with.
 *
 * The first row of the bound table when there is one, so the picture shows a
 * real label rather than `${货位号}`; the design's own standing values
 * otherwise, so the picture still appears. A column the row lacks is left
 * empty rather than shown as its placeholder — the placeholder would look
 * like content, and an empty field is what the print would actually produce.
 */
import type { VariableDefinition } from '@zenith/shared'
import { designValues } from '../../editor/preview-values.ts'

export function thumbnailValues(
  variables: readonly VariableDefinition[],
  firstRow: Readonly<Record<string, string>> | undefined,
  /** Columns the design references; those missing from the row come out empty. */
  referencedColumns: readonly string[] = [],
): Record<string, string> {
  const own = designValues(variables)
  if (firstRow === undefined) {
    return own
  }
  const blanks = Object.fromEntries(referencedColumns.map((column) => [column, '']))
  // The same precedence the print path uses: a row value wins over a constant
  // of the same name, so the picture cannot disagree with the print.
  return { ...blanks, ...own, ...firstRow }
}
