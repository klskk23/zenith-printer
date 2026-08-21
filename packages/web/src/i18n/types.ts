/**
 * Copy shape shared by every frontend locale.
 *
 * Derived from the Chinese bundle rather than hand-written: `zh-CN.ts` is the
 * source of truth for which keys exist, so a key added there and forgotten in
 * another locale is a compile error instead of a blank label at runtime.
 *
 * The literal types have to be widened first. `zh-CN.ts` is `as const`, which
 * makes each string its own type — useful there, but as a contract it would
 * demand that every locale repeat the Chinese text verbatim. What the contract
 * should say is "the same keys, holding strings".
 */
import { copy } from './zh-CN.ts'

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends (...args: infer A) => infer R
        ? (...args: A) => R
        : { -readonly [K in keyof T]: Widen<T[K]> }

export type Copy = Widen<typeof copy>

export const LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]

/** Chinese is the project default (Principle IV). */
export const DEFAULT_LOCALE: Locale = 'zh-CN'
