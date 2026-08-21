/**
 * Applying the theme.
 *
 * The setting existed, was stored, was offered in a dropdown — and nothing ever
 * read it. There was also only one palette in the stylesheet, so even a wired-up
 * dropdown would have changed nothing.
 */
import { describe, expect, it } from 'vitest'
import { applyTheme } from '../src/features/preferences/theme.ts'

function target() {
  const attrs = new Map<string, string>()
  return {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    get: (k: string) => attrs.get(k) ?? null,
  }
}

describe('applyTheme', () => {
  it('marks the root for dark', () => {
    const root = target()
    applyTheme('dark', root)
    expect(root.get('data-theme')).toBe('dark')
  })

  it('marks the root for light', () => {
    const root = target()
    applyTheme('light', root)
    expect(root.get('data-theme')).toBe('light')
  })

  /**
   * "Follow system" is the absence of a choice, not a third value. Removing the
   * attribute lets the stylesheet's media query decide — and keep deciding when
   * the system setting changes, with no listener to keep in step.
   */
  it('removes the mark for system', () => {
    const root = target()
    applyTheme('dark', root)
    applyTheme('system', root)
    expect(root.get('data-theme')).toBeNull()
  })

  it('switches cleanly between explicit themes', () => {
    const root = target()
    applyTheme('dark', root)
    applyTheme('light', root)
    expect(root.get('data-theme')).toBe('light')
  })

  it('does nothing without a document', () => {
    expect(() => applyTheme('dark', null)).not.toThrow()
  })
})
