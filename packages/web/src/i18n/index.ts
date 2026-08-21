/**
 * The active copy bundle.
 *
 * Components read `copy.something` at render time, and a preference change
 * re-renders the tree, so a module-level binding is enough — no context, no
 * hook, and no change to the several dozen call sites that already read `copy`
 * as a plain object.
 *
 * The proxy exists so that `copy` is a stable import while the bundle behind it
 * swaps. Reading a top-level key resolves against whichever bundle is active,
 * so nested access (`copy.editor.heading`) picks up the current language
 * without anything having to re-import.
 */
import { copy as zhCN } from './zh-CN.ts'
import { copy as enUS } from './en-US.ts'
import { DEFAULT_LOCALE, type Copy, type Locale } from './types.ts'

const BUNDLES: Record<Locale, Copy> = { 'zh-CN': zhCN, 'en-US': enUS }

let active: Copy = BUNDLES[DEFAULT_LOCALE]

export function setCopyLocale(locale: Locale): void {
  active = BUNDLES[locale] ?? BUNDLES[DEFAULT_LOCALE]
}

export function activeCopy(): Copy {
  return active
}

export const copy = new Proxy({} as Copy, {
  get: (_target, key) => active[key as keyof Copy],
  has: (_target, key) => key in active,
  ownKeys: () => Reflect.ownKeys(active),
  getOwnPropertyDescriptor: (_target, key) =>
    Reflect.getOwnPropertyDescriptor(active, key) ?? {
      configurable: true,
      enumerable: true,
      value: active[key as keyof Copy],
    },
})
