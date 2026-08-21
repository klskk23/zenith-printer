/**
 * Safe local storage.
 *
 * `typeof window !== 'undefined'` was the guard everywhere, and it is not
 * enough: a window can exist while `localStorage` does not, and storage that
 * exists can still throw on use when a browser is in private mode or a policy
 * blocks it. Either way the failure lands at the first read, far from the
 * assumption that caused it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStorageAvailable, safeLocalStorage } from '../src/lib/storage.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('when storage works', () => {
  it('returns the real store', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    })

    safeLocalStorage().setItem('a', '1')
    expect(safeLocalStorage().getItem('a')).toBe('1')
    expect(isStorageAvailable()).toBe(true)
  })

  it('leaves nothing behind after probing', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    })

    safeLocalStorage()
    expect([...map.keys()]).toEqual([])
  })
})

describe('when storage is missing', () => {
  it('survives localStorage being undefined', () => {
    // Exactly the case that broke the editor: a window, but no localStorage.
    vi.stubGlobal('localStorage', undefined)
    expect(() => safeLocalStorage().setItem('a', '1')).not.toThrow()
    expect(safeLocalStorage().getItem('a')).toBeNull()
    expect(isStorageAvailable()).toBe(false)
  })
})

describe('when storage throws', () => {
  it('survives a store that rejects writes', () => {
    // Private browsing and enterprise policies both do this: the property is
    // there, and using it throws.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    })

    expect(() => safeLocalStorage().setItem('a', '1')).not.toThrow()
    expect(isStorageAvailable()).toBe(false)
  })

  it('survives a store that throws on read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    expect(safeLocalStorage().getItem('a')).toBeNull()
  })
})
