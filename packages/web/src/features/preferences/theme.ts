/**
 * Apply the chosen theme to the document.
 *
 * "Follow system" is the *absence* of a choice, so it removes the attribute
 * rather than setting a third value — that way the media query in the
 * stylesheet decides, and it keeps deciding when the system setting changes,
 * with no listener to keep in step.
 */
export type Theme = 'light' | 'dark' | 'system'

/** Just enough of an element to carry the attribute; keeps this testable. */
export interface ThemeTarget {
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

function documentRoot(): ThemeTarget | null {
  // Reached through globalThis so this module needs no DOM lib to typecheck;
  // the logic here is what matters and it is worth testing without one.
  const doc = (globalThis as { document?: { documentElement?: ThemeTarget } }).document
  return doc?.documentElement ?? null
}

export function applyTheme(theme: Theme, root: ThemeTarget | null = documentRoot()): void {
  if (root === null) {
    return
  }
  if (theme === 'system') {
    root.removeAttribute('data-theme')
    return
  }
  root.setAttribute('data-theme', theme)
}
