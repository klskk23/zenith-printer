/**
 * One id per browser window, for the life of that window.
 *
 * `sessionStorage` is exactly that scope — per tab, cleared when it closes —
 * which is why it holds the id and `localStorage` does not. The id is only
 * ever compared with a draft's `writerId`, so it needs to be stable and
 * distinct, not secret.
 */
import { describe, expect, it } from 'vitest'
import { windowId } from '../../src/features/drafts/window-id.ts'

function fakeSession(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('windowId', () => {
  it('is the same on every read within one window', () => {
    const session = fakeSession()
    expect(windowId(session, () => 'abc')).toBe('abc')
    expect(windowId(session, () => 'xyz')).toBe('abc')
  })

  it('differs between windows', () => {
    let n = 0
    const random = (): string => `id-${(n += 1)}`
    expect(windowId(fakeSession(), random)).not.toBe(windowId(fakeSession(), random))
  })

  it('still answers when session storage is unavailable', () => {
    expect(windowId(null, () => 'fallback')).toBe('fallback')
  })

  it('still answers when session storage throws', () => {
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(windowId(broken, () => 'fallback')).toBe('fallback')
  })
})
