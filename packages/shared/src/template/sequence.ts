/**
 * Sequence formatting.
 *
 * Overflow is refused rather than truncated or wrapped: a silently wrapped
 * serial reissues numbers that already exist on physical labels, and a
 * repeated serial is the one failure the sequence feature exists to prevent.
 * A skipped number is a gap in a ledger; a repeated one is two boxes nobody
 * can tell apart.
 */
export class SequenceOverflowError extends Error {
  readonly variableName: string
  readonly value: number
  readonly digits: number

  constructor(variableName: string, value: number, digits: number) {
    super(`sequence "${variableName}" reached ${value}, which exceeds ${digits} digits`)
    this.name = 'SequenceOverflowError'
    this.variableName = variableName
    this.value = value
    this.digits = digits
  }
}

/** Largest value the configured width can represent. */
export function maxRepresentable(digits: number): number {
  return 10 ** digits - 1
}

export function formatSequence(variableName: string, value: number, digits: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`sequence value must be a non-negative integer, received ${value}`)
  }
  if (!Number.isInteger(digits) || digits < 1) {
    throw new Error(`sequence digits must be a positive integer, received ${digits}`)
  }
  if (value > maxRepresentable(digits)) {
    throw new SequenceOverflowError(variableName, value, digits)
  }
  return String(value).padStart(digits, '0')
}
