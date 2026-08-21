/**
 * What a printer card should say about remaining stock.
 *
 * Extracted from the card so the rule can be checked directly. FR-026 is easy
 * to satisfy accidentally-wrongly: leaving the line blank for a model that
 * cannot report looks like "no data yet" when it actually means "this model
 * will never tell you, and will stop mid-batch without warning".
 */
import type { Printer } from '../api/types.ts'

export type ConsumableDisplay =
  | { kind: 'not-probed' }
  | { kind: 'supported' }
  | { kind: 'unsupported' }

export function consumableDisplay(printer: Printer): ConsumableDisplay {
  if (printer.capabilities === null) {
    return { kind: 'not-probed' }
  }
  return printer.capabilities.supportsConsumableLevel ? { kind: 'supported' } : { kind: 'unsupported' }
}
