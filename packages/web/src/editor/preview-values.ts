/**
 * Standing content for a design that is still being written.
 *
 * The print path refuses to draw a reference it has no value for, and rightly:
 * a label reading "${sku}" is waste that looks like output. The editor is where
 * those references get written, though, so it has to have an answer for every
 * one of them — including the ones with no good answer, such as a reference to
 * a variable somebody just deleted.
 *
 * So this never throws. A design mid-edit is full of states that are not
 * printable yet, and the editor has to survive all of them; the guards say what
 * is wrong, and the print path refuses on its own terms.
 */
import { evaluateIr, type LabelIR, type VariableDefinition } from '@zenith/shared'

export interface PreviewResult {
  ir: LabelIR
  /** Closed references with nothing behind them. Reported, never thrown. */
  unresolved: string[]
}

/**
 * Values the design itself supplies.
 *
 * A sequence variable shows the number the next label would carry — padded,
 * because the padded form is what the label will be laid out around. `nextValue`
 * is unknown until the pool is loaded, so it falls back to the first number.
 */
export function designValues(
  variables: readonly VariableDefinition[],
  poolNext: Readonly<Record<string, { value: number; digits: number }>> = {},
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const variable of variables) {
    if (variable.kind === 'constant') {
      values[variable.name] = variable.value
      continue
    }
    const next = poolNext[variable.poolId]
    values[variable.name] = next === undefined ? '1' : String(next.value).padStart(next.digits, '0')
  }
  return values
}

/**
 * The design as it should be drawn, with references substituted.
 *
 * A copy: the stored IR keeps its references, so an edit made while looking at
 * a substituted value writes back the reference rather than the value.
 */
export function previewIr(ir: LabelIR, values: Readonly<Record<string, string>>): PreviewResult {
  return evaluateIr(ir, values)
}
