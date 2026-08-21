/**
 * The two frontend locales must agree on structure.
 *
 * The type system already enforces this — `Copy` is derived from the Chinese
 * bundle — but a type only checks what it can see. These check the two things
 * it cannot: that the English bundle is actually in English, and that the shape
 * really is identical rather than merely assignable.
 */
import { describe, expect, it } from 'vitest'
import { copy as zhCN } from '../src/i18n/zh-CN.ts'
import { copy as enUS } from '../src/i18n/en-US.ts'

type Node = Record<string, unknown>

function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.entries(value as Node).flatMap(([key, child]) =>
    paths(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

/** Every string reachable in a bundle, with functions called on sample input. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (typeof value === 'function') {
    try {
      // Enough to exercise the common signatures; a throw just means this one
      // needs different input and is not worth asserting on.
      return [String((value as (...a: unknown[]) => unknown)(1, 2, 3))]
    } catch {
      return []
    }
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Node).flatMap(strings)
  }
  return []
}

const hasHan = (text: string): boolean => /[一-鿿]/.test(text)

describe('structure', () => {
  it('has the same key paths in both locales', () => {
    expect(paths(enUS).sort()).toEqual(paths(zhCN).sort())
  })

  it('has the same value kinds at every path', () => {
    const kinds = (bundle: unknown): string[] =>
      paths(bundle).map((path) => {
        const value = path.split('.').reduce<unknown>((node, key) => (node as Node)?.[key], bundle)
        return `${path}:${typeof value}`
      })
    expect(kinds(enUS).sort()).toEqual(kinds(zhCN).sort())
  })
})

describe('the English bundle is English', () => {
  it('leaves no Chinese text behind', () => {
    const untranslated = strings(enUS).filter(hasHan)
    // Language names are the exception: "中文" is the name of the language and
    // stays in it, the same way English stays "English" in the Chinese bundle.
    const allowed = ['中文']
    expect(untranslated.filter((text) => !allowed.includes(text))).toEqual([])
  })

  it('has no empty strings, which would render as a blank control', () => {
    expect(strings(enUS).filter((text) => text.trim().length === 0)).toEqual([])
  })
})

describe('the Chinese bundle', () => {
  it('still holds the copy it always did', () => {
    expect(strings(zhCN).some(hasHan)).toBe(true)
  })
})
