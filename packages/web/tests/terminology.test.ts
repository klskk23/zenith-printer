/**
 * One name for the thing this product makes: 「标签」.
 *
 * It was 「模板」 in the interface for four features, and a design interview
 * settled on 「标签」 — the entity and the printed object are the same word,
 * told apart by the measure word (「3 张」 is paper; 「货架标签」 is a
 * definition). Constitution III.0 asks for one name per concept across the
 * whole product, so the old word is locked out of every string a person can
 * see. Keys stay English and are not checked; `templateId` on the wire is a
 * field name, not copy.
 */
import { describe, expect, it } from 'vitest'
import { copy as zhCN } from '../src/i18n/zh-CN.ts'
import { copy as enUS } from '../src/i18n/en-US.ts'

type Node = Record<string, unknown>

/** Every string reachable in a bundle, with functions called on sample input, each with its path. */
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') {
    return [[path, value]]
  }
  if (typeof value === 'function') {
    try {
      const out = (value as (...a: unknown[]) => unknown)('样例', 2, 3)
      return typeof out === 'string' ? [[path, out]] : []
    } catch {
      return []
    }
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Node).flatMap(([key, child]) => strings(child, path === '' ? key : `${path}.${key}`))
  }
  return []
}

describe('the word 模板', () => {
  it('appears in no Chinese copy', () => {
    const hits = strings(zhCN).filter(([, text]) => text.includes('模板'))
    expect(hits.map(([path, text]) => `${path}: ${text}`)).toEqual([])
  })

  it('appears in no English copy either', () => {
    const hits = strings(enUS).filter(([, text]) => /\btemplates?\b/i.test(text))
    expect(hits.map(([path, text]) => `${path}: ${text}`)).toEqual([])
  })

  it('would be caught if it came back', () => {
    // The scan, scanned.
    expect(strings({ a: { b: () => '一个模板' } }).some(([, t]) => t.includes('模板'))).toBe(true)
  })
})
