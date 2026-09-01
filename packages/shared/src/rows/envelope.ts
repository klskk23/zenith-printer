/**
 * The row envelope: one shape for rows arriving from anywhere but a file.
 *
 * Two paths carry it and they point in opposite directions — an HTTP data
 * source *fetches* one, a print preset is *handed* one — so it is defined once
 * here rather than twice, once per direction, where the two could drift.
 *
 * **Every value is a string.** Nothing is parsed, inferred or coerced: a column
 * holds what a label will print, and the moment this guesses that `08` is the
 * number eight or that `2026-09-01` is a date, some label somewhere loses a
 * leading zero or gains a timezone. Whoever produces the envelope decides how a
 * date or a boolean reads to a person; that decision cannot be made here,
 * because here does not know what language the label is in.
 *
 * **`columns` is ordered and authoritative**, and every row's key set must match
 * it exactly — no missing key, no extra one. A missing key would print a blank
 * where a value belongs, and neither a blank label nor a silently dropped
 * column is something anybody notices before the stock is used up.
 *
 * Column names may be any legal identifier, Chinese included. No prefix carries
 * meaning here; a name is a name.
 */
import { z } from 'zod'

/**
 * The same rule the CSV importer applies, for the same reason: a column name is
 * a reference name — a design writes `${收件人}` — and `}` would close the
 * reference in the middle of it.
 */
const envelopeColumnSchema = z
  .string()
  .transform((name) => name.trim())
  .refine((name) => name.length > 0, { message: 'a column must have a name' })
  .refine((name) => !name.includes('}'), { message: 'a column name must not contain "}"' })

export const rowEnvelopeSchema = z
  .object({
    columns: z
      .array(envelopeColumnSchema)
      .min(1)
      .refine((columns) => new Set(columns).size === columns.length, {
        // A duplicate leaves `${收件人}` with no way to say which one it means.
        message: 'column names must be unique',
      }),
    rows: z.array(z.record(z.string(), z.string())),
    /**
     * Only meaningful when fetching. A pushed envelope may omit them, in which
     * case the batch is exactly the rows it carries.
     */
    total: z.number().int().min(0).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).optional(),
    generated_at: z.string().optional(),
  })
  .superRefine((envelope, ctx) => {
    const declared = new Set(envelope.columns)
    for (const [index, row] of envelope.rows.entries()) {
      const keys = Object.keys(row)
      const missing = envelope.columns.filter((column) => !(column in row))
      const extra = keys.filter((key) => !declared.has(key))
      if (missing.length === 0 && extra.length === 0) {
        continue
      }
      // Named, not counted: "row 41 is missing sn" is something the other side
      // can act on, and "a row did not match" is not.
      ctx.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: [
          missing.length > 0 ? `missing ${missing.join(', ')}` : '',
          extra.length > 0 ? `unexpected ${extra.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      })
    }
  })

export type RowEnvelope = z.infer<typeof rowEnvelopeSchema>

/**
 * How many rows the producer says exist in all.
 *
 * Absent means "what you are holding is all of it" — the pushed case. Present
 * and larger than `rows.length` means there is more to fetch.
 */
export function declaredTotal(envelope: RowEnvelope): number {
  return envelope.total ?? envelope.rows.length
}

/**
 * Where the next page starts, or null when this was the last one.
 *
 * Derived from what came back rather than from what was asked for: a producer
 * that returns fewer rows than the requested limit has run out, whatever its
 * `total` claims, and trusting the claim over the evidence is how a fetch loop
 * spins forever on an off-by-one.
 */
export function nextOffset(envelope: RowEnvelope, fetched: number): number | null {
  if (envelope.rows.length === 0) {
    return null
  }
  return fetched < declaredTotal(envelope) ? fetched : null
}
